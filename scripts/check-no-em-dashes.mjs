// Fails when any tracked text file holds a literal em dash (code point 8212)
// or a spaced en dash (8211). Tests build them from escape codes so the repo
// stays clean.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const EM = String.fromCharCode(0x2014)
const EN = String.fromCharCode(0x2013)
const SPACED_EN = new RegExp(`\\s${EN}\\s`)
const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean)

const bad = []
for (const file of files) {
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    continue
  }
  if (text.includes('\0')) continue
  text.split('\n').forEach((line, i) => {
    if (line.includes(EM) || SPACED_EN.test(line)) bad.push(`${file}:${i + 1}: ${line.trim().slice(0, 80)}`)
  })
}

if (bad.length > 0) {
  console.error(`Found ${bad.length} em dash line(s). Repunctuate (commas, full stops, colons) or use " - ":\n${bad.join('\n')}`)
  process.exit(1)
}
console.log(`No em dashes in ${files.length} tracked files.`)
