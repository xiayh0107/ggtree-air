import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright'
import { normalizeRunSpec } from '../backend/src/contracts.mjs'
import { PROJECT_ROOT } from '../backend/src/paths.mjs'
import { createWorkspace } from '../backend/src/workspace.mjs'
import { startWorkspaceServer } from '../backend/src/server.mjs'

test('canvas report exposes semantic nodes and persists feedback', { timeout: 180_000 }, async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'ggtree-air-ui-'))
  const root = path.join(parent, 'workspace')
  let browser
  let service
  try {
    const spec = await normalizeRunSpec({
      dist: path.join(PROJECT_ROOT, 'renderer/r/fixtures/easy_input.dist.tsv'),
      layouts: ['rectangular', 'circular'], intents: ['treescale'],
      render: { width: 5, height: 4, dpi: 72, formats: ['png'] },
      title: 'canvas test',
    })
    await createWorkspace({ root, spec })
    service = await startWorkspaceServer({ root, port: 0, onLog: () => undefined })
    browser = await chromium.launch({ headless: true })
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
    const pageErrors = []
    page.on('pageerror', (error) => pageErrors.push(error.message))
    await page.goto(service.url, { waitUntil: 'networkidle' })
    assert.equal(await page.locator('.canvas-node').count(), 2)
    assert.equal(await page.locator('#connection-status').textContent(), '后端已连接')

    await page.locator('[data-node-id="view-r1-rectangular"] [data-edit-node]').click()
    assert.equal(await page.locator('#node-composer:not([hidden])').count(), 1)
    assert.equal(await page.locator('#node-composer-input').count(), 1)
    await page.locator('[data-composer-annotate]').click()
    await page.locator('.scene-marker').first().waitFor()
    assert.equal(await page.locator('.scene-marker').count(), 10)
    assert.equal(await page.locator('[data-annotation-mode]').count(), 3)
    assert.equal(await page.locator('#intent-select').count(), 0)
    await page.locator('.scene-marker').first().click()
    await page.locator('#finish-selection-mode').click()
    assert.match(await page.locator('#node-composer').textContent(), /strain1/)

    await page.locator('[data-composer-annotate]').click()
    await page.locator('[data-annotation-mode="region"]').click()
    const imageBox = await page.locator('#drawer-image').boundingBox()
    await page.mouse.move(imageBox.x + imageBox.width * 0.2, imageBox.y + imageBox.height * 0.2)
    await page.mouse.down()
    await page.mouse.move(imageBox.x + imageBox.width * 0.55, imageBox.y + imageBox.height * 0.55, { steps: 5 })
    await page.mouse.up()
    await page.locator('#finish-selection-mode').click()
    assert.match(await page.locator('#node-composer').textContent(), /框选区域/)

    await page.locator('[data-composer-annotate]').click()
    await page.locator('[data-annotation-mode="draw"]').click()
    const drawBox = await page.locator('#drawer-image').boundingBox()
    await page.mouse.move(drawBox.x + drawBox.width * 0.3, drawBox.y + drawBox.height * 0.65)
    await page.mouse.down()
    await page.mouse.move(drawBox.x + drawBox.width * 0.45, drawBox.y + drawBox.height * 0.45, { steps: 8 })
    await page.mouse.move(drawBox.x + drawBox.width * 0.65, drawBox.y + drawBox.height * 0.62, { steps: 8 })
    await page.mouse.up()
    await page.locator('#finish-selection-mode').click()
    assert.match(await page.locator('#node-composer').textContent(), /自由涂鸦/)

    await page.locator('[data-composer-annotate]').click()
    await page.locator('.scene-marker').first().click()
    await page.locator('#finish-selection-mode').click()
    await page.locator('#node-composer-input').fill('Try two clearly different highlight styles for this tip')
    await page.locator('[data-composer-send]').click()
    await page.waitForFunction(async () => {
      const response = await fetch('/api/actions?status=pending')
      return (await response.json()).actions.length === 1
    })
    const pending = await (await fetch(`${service.url}/api/actions?status=pending`)).json()
    const actionId = pending.actions[0].id
    const actionNode = page.locator(`[data-node-id="agent-action-${actionId}"]`)
    await actionNode.waitFor({ state: 'visible', timeout: 15_000 })
    assert.match(await actionNode.textContent(), /等待 Agent/)

    const mutationHeaders = {
      'content-type': 'application/json',
      'x-ggtree-air-token': service.token,
    }
    await fetch(`${service.url}/api/actions/${actionId}/claim`, {
      method: 'POST', headers: mutationHeaders, body: JSON.stringify({ agent_id: 'ui-test-agent' }),
    })
    await fetch(`${service.url}/api/actions/${actionId}/running`, {
      method: 'POST', headers: mutationHeaders, body: JSON.stringify({ agent_id: 'ui-test-agent' }),
    })
    const sourceImage = path.join(root, 'tree_rectangular_intents.png')
    await fetch(`${service.url}/api/actions/${actionId}/progress`, {
      method: 'POST', headers: mutationHeaders,
      body: JSON.stringify({
        agent_id: 'ui-test-agent', phase: 'preview', percent: 65,
        message: '已生成候选，正在检查标签', preview: sourceImage,
      }),
    })
    await page.waitForFunction((id) => {
      const node = document.querySelector(`[data-node-id="agent-action-${id}"]`)
      return node?.textContent.includes('正在检查标签')
    }, actionId, { timeout: 15_000 })
    assert.equal(await page.locator(`[data-node-id="agent-action-${actionId}"] .agent-preview`).count(), 1)
    await fetch(`${service.url}/api/actions/${actionId}/complete`,  {
      method: 'POST', headers: mutationHeaders,
      body: JSON.stringify({ agent_id: 'ui-test-agent', files: [sourceImage, sourceImage] }),
    })
    await page.waitForFunction(() => document.querySelectorAll('[data-node-id^="agent-artifact-"]').length === 2,
      null, { timeout: 30_000 })
    assert.equal(await page.locator('[data-node-id^="agent-artifact-"]').count(), 2)
    assert.match(await page.locator(`[data-node-id="agent-action-${actionId}"]`).textContent(), /已生成 2 个产物/)
    assert.equal((await (await fetch(`${service.url}/api/workspace`)).json()).revision, 1)
    assert.deepEqual(pageErrors, [])
  } finally {
    if (browser) await browser.close()
    if (service) await new Promise((resolve) => service.server.close(resolve))
    await rm(parent, { recursive: true, force: true })
  }
})
