import { readFile } from 'node:fs/promises'

const readJson = async path => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'))
const pkg = await readJson('../package.json')
const lock = await readJson('../package-lock.json')
const values = {
  'package.version': pkg.version,
  'package.displayVersion': pkg.displayVersion,
  'lock.version': lock.version,
  'lock.packages[""].version': lock.packages?.['']?.version,
}
const unique = new Set(Object.values(values))
if (unique.size !== 1 || [...unique].some(value => typeof value !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value))) {
  console.error('Versionamento 4/4 inválido.', values)
  process.exit(1)
}
console.log(`Versionamento 4/4 sincronizado: ${pkg.version}`)
