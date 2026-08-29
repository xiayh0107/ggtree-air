import { cp, mkdir, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { PROJECT_ROOT } from './paths.mjs'

const SKILLS = [{
  name: 'ggtree-phylo',
  path: path.join(PROJECT_ROOT, 'skills', 'ggtree-phylo'),
}]

export function listBundledSkills() {
  return SKILLS.map((skill) => ({ ...skill }))
}

export function bundledSkillPath(name = 'ggtree-phylo') {
  const skill = SKILLS.find((candidate) => candidate.name === name)
  if (!skill) throw new Error(`Unknown bundled skill: ${name}`)
  return skill.path
}

function defaultTarget(agent) {
  const home = os.homedir()
  switch (agent) {
    case 'pi': return path.join(home, '.pi', 'agent', 'skills')
    case 'agents': return path.join(home, '.agents', 'skills')
    case 'claude': return path.join(home, '.claude', 'skills')
    case 'codex': return path.join(home, '.codex', 'skills')
    default: throw new Error('agent must be pi, agents, claude, or codex; otherwise pass --target')
  }
}

export async function installBundledSkill(name, { target, agent = 'pi', force = false } = {}) {
  const source = bundledSkillPath(name)
  const parent = target ? path.resolve(target) : defaultTarget(agent)
  const destination = path.join(parent, name)
  await mkdir(parent, { recursive: true })
  if (force) await rm(destination, { recursive: true, force: true })
  await cp(source, destination, { recursive: true, errorOnExist: !force, force })
  return { name, source, destination }
}
