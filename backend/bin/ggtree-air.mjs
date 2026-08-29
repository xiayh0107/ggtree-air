#!/usr/bin/env node
import { main } from '../src/cli.mjs'

try {
  process.exitCode = await main()
} catch (error) {
  console.error(`[ggtree-air] ${error.message}`)
  process.exitCode = 1
}
