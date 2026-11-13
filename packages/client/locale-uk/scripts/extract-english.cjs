/**
 * Extract every English UI dictionary a Client package registers with the
 * locale service. Used by the Ukrainian language pack's parity tests so the
 * tracked `uk` dictionaries stay key-complete against the English source.
 *
 * The scanner reads package sources with the TypeScript parser; it never
 * executes them. It resolves the namespace expression (a literal, a local
 * constant or an import), the registration's dictionary bundle, and the `en`
 * member through local constants, imports and re-exports; spreads, string
 * concatenations and `Array.join()` values are evaluated. Dictionary values
 * that cannot be resolved are reported instead of silently skipped.
 */

const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const SKIP_DIRECTORIES = new Set(['node_modules', 'lib', 'tests'])

const unwrap = (node) => {
  let current = node
  while (current !== undefined
    && (ts.isSatisfiesExpression(current) || ts.isAsExpression(current)
      || ts.isParenthesizedExpression(current) || ts.isTypeAssertionExpression(current))) {
    current = current.expression
  }
  return current
}

/**
 * Build the extractor over one repository root.
 * @param {string} root - repository root containing `packages/`.
 * @returns {{ namespaces: Record<string, { file: string, entries: [string, string][] }>, problems: string[] }} extracted English dictionaries.
 */
function extractEnglishDictionaries(root) {
  const cache = new Map()
  const parse = (file) => {
    const cached = cache.get(file)
    if (cached !== undefined) return cached
    const source = ts.createSourceFile(
      file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.ESNext, true,
      file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    )
    cache.set(file, source)
    return source
  }
  const walkDirectory = (directory, out) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        if (!SKIP_DIRECTORIES.has(entry.name)) walkDirectory(full, out)
      } else {
        out.push(full)
      }
    }
  }

  const packages = path.join(root, 'packages')
  const packageDirectories = new Map()
  for (const group of fs.readdirSync(packages)) {
    const groupDirectory = path.join(packages, group)
    if (!fs.statSync(groupDirectory).isDirectory()) continue
    for (const name of fs.readdirSync(groupDirectory)) {
      const packageDirectory = path.join(groupDirectory, name)
      const manifest = path.join(packageDirectory, 'package.json')
      if (!fs.existsSync(manifest)) continue
      try {
        const parsed = JSON.parse(fs.readFileSync(manifest, 'utf8'))
        if (typeof parsed.name === 'string') packageDirectories.set(parsed.name, packageDirectory)
      } catch {
        // A malformed sibling manifest is another gate's concern.
      }
    }
  }

  const resolveSpecifier = (specifier, fromFile) => {
    if (specifier.startsWith('.')) {
      const base = path.resolve(path.dirname(fromFile), specifier)
      for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts'), path.join(base, 'index.tsx')]) {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate
      }
      return undefined
    }
    const parts = specifier.split('/')
    const name = specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
    const directory = packageDirectories.get(name)
    if (directory === undefined) return undefined
    const subpath = parts.slice(name.startsWith('@') ? 2 : 1).join('/')
    if (subpath !== '') {
      for (const candidate of [path.join(directory, 'src', `${subpath}.ts`), path.join(directory, 'src', `${subpath}.tsx`)]) {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate
      }
      try {
        const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'))
        const entry = manifest.exports?.[`./${subpath}`]
        const target = entry?.types ?? entry?.default
        if (typeof target === 'string') {
          const normalized = target.replace(/^\.\/lib\/(types\/)?/, 'src/').replace(/\.(d\.ts|js|mjs)$/, '.ts')
          const candidate = path.join(directory, normalized)
          if (fs.existsSync(candidate)) return candidate
        }
      } catch {
        // Fall through to the package entry below.
      }
    }
    const base = subpath === '' ? path.join(directory, 'src', 'index.ts') : path.join(directory, subpath)
    for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate
    }
    return undefined
  }

  const moduleVariable = (file, name) => {
    for (const statement of parse(file).statements) {
      if (!ts.isVariableStatement(statement)) continue
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.name.text === name && declaration.initializer !== undefined) {
          return declaration.initializer
        }
      }
    }
    return undefined
  }

  const anyVariable = (file, name) => {
    let found
    const visit = (node) => {
      if (found !== undefined) return
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)
        && node.name.text === name && node.initializer !== undefined) {
        found = node.initializer
        return
      }
      ts.forEachChild(node, visit)
    }
    ts.forEachChild(parse(file), visit)
    return found
  }

  const importEntry = (file, name) => {
    for (const statement of parse(file).statements) {
      if (!ts.isImportDeclaration(statement)) continue
      const bindings = statement.importClause?.namedBindings
      if (bindings === undefined) continue
      if (ts.isNamespaceImport(bindings) && bindings.name.text === name) {
        return { namespace: statement.moduleSpecifier.text }
      }
      if (!ts.isNamedImports(bindings)) continue
      for (const element of bindings.elements) {
        if (element.name.text !== name) continue
        return {
          imported: element.propertyName === undefined ? element.name.text : element.propertyName.text,
          specifier: statement.moduleSpecifier.text,
        }
      }
    }
    return undefined
  }

  /** Resolve an exported or local binding to its initializer module and node. */
  const resolveExport = (file, name, depth = 0) => {
    if (depth > 40) return undefined
    const local = moduleVariable(file, name)
    if (local !== undefined) return { init: local, file }
    const imported = importEntry(file, name)
    if (imported !== undefined) {
      if (imported.specifier !== undefined) {
        const target = resolveSpecifier(imported.specifier, file)
        if (target !== undefined) return resolveExport(target, imported.imported, depth + 1)
      }
      return { namespace: imported.namespace }
    }
    for (const statement of parse(file).statements) {
      if (!ts.isExportDeclaration(statement) || statement.moduleSpecifier === undefined) continue
      if (statement.exportClause !== undefined && ts.isNamedExports(statement.exportClause)) {
        for (const element of statement.exportClause.elements) {
          if (element.name.text !== name) continue
          const original = element.propertyName === undefined ? element.name.text : element.propertyName.text
          const target = resolveSpecifier(statement.moduleSpecifier.text, file)
          if (target !== undefined) return resolveExport(target, original, depth + 1)
        }
      } else if (statement.exportClause === undefined) {
        const target = resolveSpecifier(statement.moduleSpecifier.text, file)
        if (target !== undefined) {
          const resolved = resolveExport(target, name, depth + 1)
          if (resolved !== undefined) return resolved
        }
      }
    }
    const fallback = anyVariable(file, name)
    if (fallback !== undefined) return { init: fallback, file }
    return undefined
  }

  const propertyName = (property) => {
    if (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name) || ts.isNumericLiteral(property.name)) {
      return property.name.text
    }
    return undefined
  }

  const collectObject = (file, node, depth = 0) => {
    if (depth > 40) return undefined
    const current = unwrap(node)
    if (current === undefined) return undefined
    if (ts.isObjectLiteralExpression(current)) {
      const out = {}
      for (const property of current.properties) {
        if (ts.isPropertyAssignment(property)) {
          const name = propertyName(property)
          if (name !== undefined) out[name] = collectValue(file, property.initializer, depth + 1)
        } else if (ts.isSpreadAssignment(property)) {
          const value = collectValue(file, property.expression, depth + 1)
          if (value !== undefined && typeof value === 'object') Object.assign(out, value)
        } else if (ts.isShorthandPropertyAssignment(property)) {
          out[property.name.text] = collectValue(file, ts.factory.createIdentifier(property.name.text), depth + 1)
        }
      }
      return out
    }
    if (ts.isIdentifier(current)) {
      const resolved = resolveExport(file, current.text, depth + 1)
      if (resolved === undefined) return undefined
      if (resolved.namespace !== undefined) return { __namespace: resolved.namespace }
      return collectObject(resolved.file, resolved.init, depth + 1)
    }
    if (ts.isPropertyAccessExpression(current)) {
      const base = collectValue(file, current.expression, depth + 1)
      if (base !== undefined && typeof base === 'object' && !Array.isArray(base)) return base[current.name.text]
      return undefined
    }
    return undefined
  }

  const collectValue = (file, node, depth = 0) => {
    if (depth > 40) return undefined
    const current = unwrap(node)
    if (current === undefined) return undefined
    if (ts.isStringLiteralLike(current)) return current.text
    if (ts.isTemplateExpression(current)) {
      let out = current.head.text
      for (const span of current.templateSpans) out += `{${span.expression.getText()}}${span.literal.text}`
      return out
    }
    if (ts.isObjectLiteralExpression(current)) return collectObject(file, current, depth + 1)
    if (ts.isBinaryExpression(current) && current.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const left = collectValue(file, current.left, depth + 1)
      const right = collectValue(file, current.right, depth + 1)
      if (typeof left === 'string' && typeof right === 'string') return left + right
      return undefined
    }
    if (ts.isCallExpression(current) && ts.isPropertyAccessExpression(current.expression)
      && current.expression.name.text === 'join') {
      const values = collectValue(file, current.expression.expression, depth + 1)
      const separator = current.arguments[0] === undefined ? ',' : collectValue(file, current.arguments[0], depth + 1)
      if (Array.isArray(values) && values.every(item => typeof item === 'string') && typeof separator === 'string') {
        return values.join(separator)
      }
      return undefined
    }
    if (ts.isArrayLiteralExpression(current)) {
      return current.elements.map(element => collectValue(file, element, depth + 1))
    }
    if (ts.isIdentifier(current)) {
      const resolved = resolveExport(file, current.text, depth + 1)
      if (resolved === undefined) return undefined
      if (resolved.namespace !== undefined) return { __namespace: resolved.namespace }
      return collectValue(resolved.file, resolved.init, depth + 1)
    }
    if (ts.isPropertyAccessExpression(current)) {
      let base
      if (ts.isIdentifier(current.expression)) {
        const resolved = resolveExport(file, current.expression.text, depth + 1)
        if (resolved !== undefined && resolved.init !== undefined) base = collectValue(resolved.file, resolved.init, depth + 1)
      } else {
        base = collectValue(file, current.expression, depth + 1)
      }
      if (base !== undefined && typeof base === 'object' && !Array.isArray(base)) return base[current.name.text]
      return undefined
    }
    return undefined
  }

  const isLocaleRegister = (node) => {
    if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return false
    if (node.expression.name.text !== 'register') return false
    const owner = node.expression.expression.getText()
    return owner === 'locale' || owner.endsWith('.locale')
  }

  const resolveNamespace = (file, node) => {
    const current = unwrap(node)
    if (current !== undefined && ts.isStringLiteralLike(current)) return current.text
    if (current !== undefined && ts.isIdentifier(current)) {
      const resolved = resolveExport(file, current.text)
      if (resolved !== undefined && resolved.init !== undefined) {
        const value = collectValue(resolved.file, resolved.init)
        if (typeof value === 'string') return value
      }
    }
    return undefined
  }

  const flattenEntries = (value) => {
    if (value === undefined) return undefined
    const out = []
    for (const [key, child] of Object.entries(value)) {
      if (typeof child === 'string') out.push([key, child])
      else if (child !== null && typeof child === 'object' && !Array.isArray(child)) {
        const nested = flattenEntries(child)
        if (nested === undefined) return undefined
        out.push(...nested)
      } else {
        return undefined
      }
    }
    return out
  }

  const result = { namespaces: {}, problems: [] }
  for (const group of fs.readdirSync(packages)) {
    const groupDirectory = path.join(packages, group)
    if (!fs.statSync(groupDirectory).isDirectory()) continue
    for (const name of fs.readdirSync(groupDirectory)) {
      const packageDirectory = path.join(groupDirectory, name)
      const sourceDirectory = path.join(packageDirectory, 'src')
      if (!fs.existsSync(sourceDirectory)) continue
      const files = []
      walkDirectory(sourceDirectory, files)
      for (const file of files) {
        if (!/\.tsx?$/.test(file) || file.endsWith('.d.ts')) continue
        if (!fs.readFileSync(file, 'utf8').includes('.register(')) continue
        const relative = path.relative(root, file).replaceAll('\\', '/')
        const register = (namespace, entries) => {
          if (result.namespaces[namespace] !== undefined) {
            result.problems.push(`duplicate namespace ${namespace} (${result.namespaces[namespace].file} vs ${relative})`)
            return
          }
          result.namespaces[namespace] = { file: relative, entries }
        }
        const visit = (node, ancestors) => {
          if (isLocaleRegister(node)) {
            const args = node.arguments
            if (args.length === 2) {
              const namespace = resolveNamespace(file, args[0])
              if (namespace === undefined) {
                result.problems.push(`${relative}: unresolved namespace`)
              } else {
                const bundle = collectObject(file, args[1])
                const english = bundle === undefined ? undefined : bundle.en
                if (english === undefined || typeof english === 'string') {
                  result.problems.push(`${relative}: ns ${namespace}: no en dictionary`)
                } else {
                  const entries = flattenEntries(english)
                  if (entries === undefined) result.problems.push(`${relative}: ns ${namespace}: unresolved en entries`)
                  else register(namespace, entries)
                }
              }
            } else if (args.length === 3) {
              // Per-locale form: only a loop over `[tag, dictionary]` pairs
              // contributes a translatable bundle; single-locale registration
              // (a language pack adding its own dictionary) is not a source.
              const namespace = resolveNamespace(file, args[0])
              const loop = ancestors.slice().reverse().find(candidate => ts.isForOfStatement(candidate))
              const iterable = loop !== undefined && ts.isIdentifier(loop.expression) ? loop.expression.text : undefined
              const pairs = iterable === undefined ? undefined : collectValue(file, ts.factory.createIdentifier(iterable))
              if (Array.isArray(pairs) && namespace !== undefined) {
                const englishPair = pairs.find(pair => Array.isArray(pair) && pair[0] === 'en')
                const entries = englishPair === undefined ? undefined : flattenEntries(englishPair[1])
                if (entries === undefined) result.problems.push(`${relative}: ns ${namespace}: unresolved per-locale en entries`)
                else register(namespace, entries)
              }
            }
          }
          ts.forEachChild(node, child => visit(child, [...ancestors, node]))
        }
        visit(parse(file), [])
      }
    }
  }
  return result
}

module.exports = { extractEnglishDictionaries }

if (require.main === module) {
  const repositoryRoot = path.resolve(__dirname, '../../../..')
  const result = extractEnglishDictionaries(repositoryRoot)
  const namespaces = Object.entries(result.namespaces)
    .sort(([left], [right]) => left.localeCompare(right))
  for (const [namespace, data] of namespaces) {
    console.log(`${String(data.entries.length).padStart(4)} ${namespace} (${data.file})`)
  }
  const total = namespaces.reduce((sum, [, data]) => sum + data.entries.length, 0)
  console.log(`\n${namespaces.length} namespaces, ${total} keys`)
  for (const problem of result.problems) console.error(problem)
  if (result.problems.length > 0) process.exitCode = 1
}
