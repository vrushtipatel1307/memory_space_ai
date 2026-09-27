import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

for (const envFile of ['.env', '.env.local']) {
  const envPath = resolve(envFile)
  if (!existsSync(envPath)) continue
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
    if (!match) continue
    const [, key, rawValue] = match
    const value = rawValue.replace(/^(['"])(.*)\1$/, '$2').trim()
    if (process.env[key] === undefined || envFile === '.env.local') process.env[key] = value
  }
}

const processes = [
  spawn(process.execPath, [resolve('node_modules/tsx/dist/cli.mjs'), 'server/index.ts'], { stdio: 'inherit' }),
  spawn(process.execPath, [resolve('node_modules/vite/bin/vite.js')], { stdio: 'inherit' }),
]

let stopping = false
function stop(code = 0) {
  if (stopping) return
  stopping = true
  for (const child of processes) if (child.exitCode === null) child.kill('SIGTERM')
  process.exitCode = code
}

for (const child of processes) {
  child.on('error', (error) => { console.error(error); stop(1) })
  child.on('exit', (code) => {
    if (!stopping) stop(code ?? 1)
  })
}

process.on('SIGINT', () => stop(0))
process.on('SIGTERM', () => stop(0))
