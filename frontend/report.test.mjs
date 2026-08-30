import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright'
import { normalizeRunSpec } from '../backend/src/contracts.mjs'
import { PROJECT_ROOT } from '../backend/src/paths.mjs'
import { createArtifactWorkspace, createWorkspace } from '../backend/src/workspace.mjs'
import { importWorkspaceArtifact } from '../backend/src/actions.mjs'
import { beginAgentPresence } from '../backend/src/agent-presence.mjs'
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
    service = await startWorkspaceServer({ root, port: 0, agentAdapter: 'none', onLog: () => undefined })
    browser = await chromium.launch({ headless: true })
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
    const pageErrors = []
    page.on('pageerror', (error) => pageErrors.push(error.message))
    await page.goto(service.url, { waitUntil: 'networkidle' })
    assert.equal(await page.locator('.canvas-node').count(), 2)
    await page.waitForFunction(() => document.querySelector('#connection-status')?.textContent === 'Agent 未连接')
    assert.equal(await page.locator('#connection-status').textContent(), 'Agent 未连接')

    await page.locator('[data-tool="workspaces"]').click()
    assert.match(await page.locator('.workspace-panel').textContent(), /真实输入与 Agent 产物|尚未导入输入资源/)
    assert.equal(await page.locator('.demo-card').count(), 0)
    await page.locator('[data-close]').click()
    await page.waitForTimeout(220)

    const rectangularNode = page.locator('[data-node-id="view-r1-rectangular"]')
    await rectangularNode.hover()
    assert.equal(await rectangularNode.locator('.node-footer [data-edit-node]').count(), 0)
    assert.equal(await rectangularNode.locator('.node-actions [data-edit-node]').count(), 1)
    assert.equal(await rectangularNode.locator('[data-fullscreen-node]').count(), 1)
    await rectangularNode.locator('[data-fullscreen-node]').click()
    await page.locator('.canvas-node.node-maximized').waitFor()
    const fullscreenNodeBox = await page.locator('.canvas-node.node-maximized').boundingBox()
    assert.ok(fullscreenNodeBox.width > 1200)
    assert.ok(fullscreenNodeBox.height > 700)
    await page.locator('.canvas-node.node-maximized [data-fullscreen-node]').click()
    assert.equal(await page.locator('.canvas-node.node-maximized').count(), 0)

    await rectangularNode.hover()
    await rectangularNode.locator('[data-open-node]').click()
    await page.locator('[data-drawer-fullscreen]').click()
    await page.locator('#right-drawer.fullscreen').waitFor()
    const fullscreenDrawerBox = await page.locator('#right-drawer').boundingBox()
    assert.ok(fullscreenDrawerBox.width > 1200)
    assert.ok(fullscreenDrawerBox.height > 700)
    await page.keyboard.press('Escape')
    assert.equal(await page.locator('#right-drawer.fullscreen').count(), 0)
    assert.match(await page.locator('#right-drawer').getAttribute('class'), /open/)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(220)

    await rectangularNode.hover()
    await rectangularNode.locator('[data-edit-node]').click()
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
    const outputA = path.join(parent, 'output-a.txt')
    const outputB = path.join(parent, 'output-b.txt')
    await writeFile(outputA, 'real output A\n')
    await writeFile(outputB, 'real output B\n')
    const completeResponse = await fetch(`${service.url}/api/actions/${actionId}/complete`,  {
      method: 'POST', headers: mutationHeaders,
      body: JSON.stringify({ agent_id: 'ui-test-agent', files: [outputA, outputB] }),
    })
    assert.equal(completeResponse.status, 200)
    await page.waitForFunction(() => document.querySelectorAll('[data-node-id^="agent-artifact-"]').length === 2,
      null, { timeout: 30_000 })
    assert.equal(await page.locator('[data-node-id^="agent-artifact-"]').count(), 2)
    assert.match(await page.locator(`[data-node-id="agent-action-${actionId}"]`).textContent(), /已生成 2 个产物/)
    assert.equal(await page.locator(`[data-node-id="agent-action-${actionId}"] [data-open-run]`).textContent(), '查看过程')
    assert.equal((await (await fetch(`${service.url}/api/workspace`)).json()).revision, 1)
    assert.deepEqual(pageErrors, [])
  } finally {
    if (browser) await browser.close()
    if (service) await new Promise((resolve) => service.server.close(resolve))
    await rm(parent, { recursive: true, force: true })
  }
})

test('artifact-first canvas exposes a visible first-task action and external Agent presence', { timeout: 60_000 }, async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'ggtree-air-first-task-ui-'))
  const root = path.join(parent, 'workspace')
  let browser
  let service
  let presence
  try {
    await createArtifactWorkspace({ root, title: 'first task UI' })
    const tree = path.join(parent, 'tree.nwk')
    const metadata = path.join(parent, 'metadata.tsv')
    await writeFile(tree, '(a:1,b:1);\n')
    await writeFile(metadata, 'tip\tgroup\na\tA\nb\tB\n')
    await importWorkspaceArtifact(root, tree, { role: 'user-input' })
    await importWorkspaceArtifact(root, metadata, { role: 'user-input' })
    presence = await beginAgentPresence(root, 'codex', { state: 'waiting' })
    service = await startWorkspaceServer({
      root, port: 0, agentAdapter: 'none',
      piCommand: path.join(parent, 'missing-pi'),
      codexCommand: path.join(parent, 'missing-codex'),
      claudeCommand: path.join(parent, 'missing-claude'),
      onLog: () => undefined,
    })
    browser = await chromium.launch({ headless: true })
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
    await page.goto(service.url, { waitUntil: 'networkidle' })
    await page.waitForFunction(() => document.querySelector('#connection-status')?.textContent === 'Agent 已连接')
    assert.equal(await page.locator('[data-start-task]').count(), 2)
    assert.match(await page.locator('.canvas-hint').textContent(), /开始任务/)

    const inputNodes = page.locator('[data-node-id^="workspace-artifact"]')
    await inputNodes.nth(0).click({ modifiers: ['Shift'] })
    await inputNodes.nth(1).click({ modifiers: ['Shift'] })
    assert.equal(await page.locator('.react-flow__node.selected').count(), 2)
    assert.equal(await page.locator('.selection-toolbar').getAttribute('data-selection-count'), '2')
    await page.locator('[data-selection-task]').click()
    assert.equal(await page.locator('#node-composer').count(), 1)
    assert.equal(await page.locator('[data-composer-source]:checked').count(), 2)
    await page.locator('[data-composer-close]').click()
    await page.locator('[data-selection-clear]').click()

    const firstBox = await inputNodes.nth(0).boundingBox()
    const secondBox = await inputNodes.nth(1).boundingBox()
    const left = Math.max(80, Math.min(firstBox.x, secondBox.x) - 18)
    const top = Math.max(80, Math.min(firstBox.y, secondBox.y) - 18)
    const right = Math.max(firstBox.x + firstBox.width, secondBox.x + secondBox.width) + 18
    const bottom = Math.max(firstBox.y + firstBox.height, secondBox.y + secondBox.height) + 18
    await page.keyboard.down('Shift')
    await page.mouse.move(left, top)
    await page.mouse.down()
    await page.mouse.move(right, bottom, { steps: 12 })
    await page.mouse.up()
    await page.keyboard.up('Shift')
    assert.equal(await page.locator('.react-flow__node.selected').count(), 2)
    const beforeFirst = await inputNodes.nth(0).boundingBox()
    const beforeSecond = await inputNodes.nth(1).boundingBox()
    await page.mouse.move(beforeFirst.x + 80, beforeFirst.y + 18)
    await page.mouse.down()
    await page.mouse.move(beforeFirst.x + 160, beforeFirst.y + 68, { steps: 8 })
    await page.mouse.up()
    const afterFirst = await inputNodes.nth(0).boundingBox()
    const afterSecond = await inputNodes.nth(1).boundingBox()
    assert.ok(Math.abs((afterFirst.x - beforeFirst.x) - (afterSecond.x - beforeSecond.x)) < 3)
    assert.ok(Math.abs((afterFirst.y - beforeFirst.y) - (afterSecond.y - beforeSecond.y)) < 3)

    await page.locator('[data-selection-clear]').click()
    await page.locator('[data-start-task]').first().click()
    assert.equal(await page.locator('#node-composer').count(), 1)
    assert.equal(await page.locator('[data-composer-source]:checked').count(), 2)
  } finally {
    if (browser) await browser.close()
    if (service) await new Promise((resolve) => service.server.close(resolve))
    if (presence) await presence.close()
    await rm(parent, { recursive: true, force: true })
  }
})
