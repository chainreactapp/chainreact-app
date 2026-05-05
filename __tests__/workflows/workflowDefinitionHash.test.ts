/**
 * Contract: hashWorkflowDefinition
 * Source: lib/workflows/workflowDefinitionHash.ts
 *
 * Background: PR-R1a, commit 2 of the safe-resume-from-failed-node
 * project. This hash is persisted on workflow_execution_sessions and
 * gates resume eligibility — if the current workflow's hash differs
 * from the persisted one, resume is blocked and the user must full
 * retry.
 *
 * Plan: learning/docs/safe-resume-from-failed-node-implementation-plan.md
 */

import { hashWorkflowDefinition } from '@/lib/workflows/workflowDefinitionHash'

describe('hashWorkflowDefinition — order independence (user req #1)', () => {
  test('node array order does not affect hash', () => {
    const a = {
      nodes: [
        { id: 'n1', type: 't1', config: { x: 1 } },
        { id: 'n2', type: 't2', config: { y: 2 } },
      ],
      edges: [],
    }
    const b = {
      nodes: [
        { id: 'n2', type: 't2', config: { y: 2 } },
        { id: 'n1', type: 't1', config: { x: 1 } },
      ],
      edges: [],
    }
    expect(hashWorkflowDefinition(a)).toBe(hashWorkflowDefinition(b))
  })

  test('edge array order does not affect hash (v2 shape)', () => {
    const nodes = [
      { id: 'n1', type: 't1' },
      { id: 'n2', type: 't2' },
      { id: 'n3', type: 't3' },
    ]
    const a = {
      nodes,
      edges: [
        { id: 'e1', from: { nodeId: 'n1', portId: 'source' }, to: { nodeId: 'n2', portId: 'target' } },
        { id: 'e2', from: { nodeId: 'n2', portId: 'source' }, to: { nodeId: 'n3', portId: 'target' } },
      ],
    }
    const b = {
      nodes,
      edges: [
        { id: 'e2', from: { nodeId: 'n2', portId: 'source' }, to: { nodeId: 'n3', portId: 'target' } },
        { id: 'e1', from: { nodeId: 'n1', portId: 'source' }, to: { nodeId: 'n2', portId: 'target' } },
      ],
    }
    expect(hashWorkflowDefinition(a)).toBe(hashWorkflowDefinition(b))
  })

  test('object key insertion order inside a node does not affect hash', () => {
    const a = {
      nodes: [{ id: 'n1', type: 't1', config: { a: 1, b: 2 }, label: 'L' }],
      edges: [],
    }
    const b = {
      nodes: [{ label: 'L', config: { b: 2, a: 1 }, type: 't1', id: 'n1' }],
      edges: [],
    }
    expect(hashWorkflowDefinition(a)).toBe(hashWorkflowDefinition(b))
  })
})

describe('hashWorkflowDefinition — execution-relevant changes (user req #2)', () => {
  const baseline = {
    nodes: [
      { id: 'n1', type: 'gmail_send', config: { to: 'a@x', subject: 'hi' } },
    ],
    edges: [],
  }

  test('changing a config value flips the hash', () => {
    const changed = {
      nodes: [
        { id: 'n1', type: 'gmail_send', config: { to: 'a@x', subject: 'changed' } },
      ],
      edges: [],
    }
    expect(hashWorkflowDefinition(changed)).not.toBe(hashWorkflowDefinition(baseline))
  })

  test('adding a config field flips the hash', () => {
    const changed = {
      nodes: [
        { id: 'n1', type: 'gmail_send', config: { to: 'a@x', subject: 'hi', body: 'new' } },
      ],
      edges: [],
    }
    expect(hashWorkflowDefinition(changed)).not.toBe(hashWorkflowDefinition(baseline))
  })

  test('changing node type flips the hash', () => {
    const changed = {
      nodes: [
        { id: 'n1', type: 'slack_send', config: { to: 'a@x', subject: 'hi' } },
      ],
      edges: [],
    }
    expect(hashWorkflowDefinition(changed)).not.toBe(hashWorkflowDefinition(baseline))
  })

  test('changing node id flips the hash (downstream variable references break)', () => {
    const changed = {
      nodes: [
        { id: 'n1-renamed', type: 'gmail_send', config: { to: 'a@x', subject: 'hi' } },
      ],
      edges: [],
    }
    expect(hashWorkflowDefinition(changed)).not.toBe(hashWorkflowDefinition(baseline))
  })

  test('changing nested config (deep) flips the hash', () => {
    const a = {
      nodes: [{ id: 'n1', type: 't1', config: { params: { retries: 3 } } }],
      edges: [],
    }
    const b = {
      nodes: [{ id: 'n1', type: 't1', config: { params: { retries: 4 } } }],
      edges: [],
    }
    expect(hashWorkflowDefinition(a)).not.toBe(hashWorkflowDefinition(b))
  })
})

describe('hashWorkflowDefinition — volatile UI fields ignored (user req #3)', () => {
  const baseline = {
    nodes: [
      { id: 'n1', type: 't1', config: { x: 1 } },
      { id: 'n2', type: 't2', config: { y: 2 } },
    ],
    edges: [
      { id: 'e1', from: { nodeId: 'n1', portId: 'source' }, to: { nodeId: 'n2', portId: 'target' } },
    ],
  }
  const baselineHash = hashWorkflowDefinition(baseline)

  test('node position changes do not affect hash', () => {
    const moved = {
      ...baseline,
      nodes: [
        { ...baseline.nodes[0], position: { x: 100, y: 200 }, positionAbsolute: { x: 100, y: 200 } },
        { ...baseline.nodes[1], position: { x: 500, y: 600 } },
      ],
    }
    expect(hashWorkflowDefinition(moved)).toBe(baselineHash)
  })

  test('selected/dragging/measured do not affect hash', () => {
    const interactive = {
      ...baseline,
      nodes: [
        { ...baseline.nodes[0], selected: true, dragging: false, measured: { width: 200, height: 50 } },
        { ...baseline.nodes[1], selected: false, dragging: true },
      ],
    }
    expect(hashWorkflowDefinition(interactive)).toBe(baselineHash)
  })

  test('width/height (canvas sizes) do not affect hash', () => {
    const resized = {
      ...baseline,
      nodes: [
        { ...baseline.nodes[0], width: 250, height: 80 },
        { ...baseline.nodes[1], width: 250, height: 80 },
      ],
    }
    expect(hashWorkflowDefinition(resized)).toBe(baselineHash)
  })

  test('__-prefixed UI cache keys (e.g. config.__dynamicOptions) do not affect hash', () => {
    const withCache = {
      ...baseline,
      nodes: [
        {
          ...baseline.nodes[0],
          config: {
            x: 1,
            __dynamicOptions: {
              spreadsheetId: [
                { label: 'Sheet 1', value: 'abc' },
                { label: 'Sheet 2', value: 'def' },
              ],
            },
          },
        },
        baseline.nodes[1],
      ],
    }
    expect(hashWorkflowDefinition(withCache)).toBe(baselineHash)
  })

  test('edge animated/style/className do not affect hash', () => {
    const styled = {
      ...baseline,
      edges: [
        {
          ...baseline.edges[0],
          animated: true,
          style: { stroke: 'red' },
          className: 'highlight',
        },
      ],
    }
    expect(hashWorkflowDefinition(styled)).toBe(baselineHash)
  })

  test('combined volatile changes still produce same hash', () => {
    const noisy = {
      nodes: [
        {
          id: 'n2',  // out of order
          type: 't2',
          config: { y: 2, __dynamicOptions: ['cached'] },
          position: { x: 999, y: 999 },
          selected: true,
          width: 300,
          height: 60,
          measured: { width: 300, height: 60 },
        },
        {
          id: 'n1',
          type: 't1',
          config: { x: 1 },
          position: { x: 50, y: 50 },
          dragging: true,
        },
      ],
      edges: [
        {
          id: 'e1',
          from: { nodeId: 'n1', portId: 'source' },
          to: { nodeId: 'n2', portId: 'target' },
          animated: true,
          style: { stroke: 'blue' },
          selected: true,
        },
      ],
    }
    expect(hashWorkflowDefinition(noisy)).toBe(baselineHash)
  })
})

describe('hashWorkflowDefinition — edge changes (user req #4)', () => {
  const nodes = [
    { id: 'n1', type: 't1' },
    { id: 'n2', type: 't2' },
    { id: 'n3', type: 't3' },
  ]

  test('adding an edge flips the hash', () => {
    const a = {
      nodes,
      edges: [
        { id: 'e1', from: { nodeId: 'n1', portId: 'source' }, to: { nodeId: 'n2', portId: 'target' } },
      ],
    }
    const b = {
      nodes,
      edges: [
        { id: 'e1', from: { nodeId: 'n1', portId: 'source' }, to: { nodeId: 'n2', portId: 'target' } },
        { id: 'e2', from: { nodeId: 'n2', portId: 'source' }, to: { nodeId: 'n3', portId: 'target' } },
      ],
    }
    expect(hashWorkflowDefinition(a)).not.toBe(hashWorkflowDefinition(b))
  })

  test('removing an edge flips the hash', () => {
    const a = {
      nodes,
      edges: [
        { id: 'e1', from: { nodeId: 'n1', portId: 'source' }, to: { nodeId: 'n2', portId: 'target' } },
      ],
    }
    const b = {
      nodes,
      edges: [],
    }
    expect(hashWorkflowDefinition(a)).not.toBe(hashWorkflowDefinition(b))
  })

  test('changing edge target flips the hash', () => {
    const a = {
      nodes,
      edges: [
        { id: 'e1', from: { nodeId: 'n1', portId: 'source' }, to: { nodeId: 'n2', portId: 'target' } },
      ],
    }
    const b = {
      nodes,
      edges: [
        { id: 'e1', from: { nodeId: 'n1', portId: 'source' }, to: { nodeId: 'n3', portId: 'target' } },
      ],
    }
    expect(hashWorkflowDefinition(a)).not.toBe(hashWorkflowDefinition(b))
  })

  test('changing source handle affects routing → flips hash', () => {
    const a = {
      nodes,
      edges: [
        { id: 'e1', from: { nodeId: 'n1', portId: 'source-true' }, to: { nodeId: 'n2', portId: 'target' } },
      ],
    }
    const b = {
      nodes,
      edges: [
        { id: 'e1', from: { nodeId: 'n1', portId: 'source-false' }, to: { nodeId: 'n2', portId: 'target' } },
      ],
    }
    expect(hashWorkflowDefinition(a)).not.toBe(hashWorkflowDefinition(b))
  })

  test('v1 edge shape (source/target) — changing target flips hash', () => {
    const a = {
      nodes,
      edges: [{ id: 'e1', source: 'n1', target: 'n2' }],
    }
    const b = {
      nodes,
      edges: [{ id: 'e1', source: 'n1', target: 'n3' }],
    }
    expect(hashWorkflowDefinition(a)).not.toBe(hashWorkflowDefinition(b))
  })

  test('v1 edge shape — changing sourceHandle flips hash', () => {
    const a = {
      nodes,
      edges: [{ id: 'e1', source: 'n1', sourceHandle: 'true', target: 'n2' }],
    }
    const b = {
      nodes,
      edges: [{ id: 'e1', source: 'n1', sourceHandle: 'false', target: 'n2' }],
    }
    expect(hashWorkflowDefinition(a)).not.toBe(hashWorkflowDefinition(b))
  })
})

describe('hashWorkflowDefinition — empty / minimal / determinism (user req #5)', () => {
  test('empty workflow hashes deterministically', () => {
    const empty = { nodes: [], edges: [] }
    expect(hashWorkflowDefinition(empty)).toBe(hashWorkflowDefinition(empty))
    // SHA-256 of `{"edges":[],"nodes":[]}` (canonical form sorts keys)
    expect(hashWorkflowDefinition(empty)).toMatch(/^[0-9a-f]{64}$/)
  })

  test('completely empty input (no nodes, no edges keys) === explicit empties', () => {
    expect(hashWorkflowDefinition({})).toBe(hashWorkflowDefinition({ nodes: [], edges: [] }))
  })

  test('connections (legacy alias) hashes the same as edges', () => {
    const e = {
      nodes: [{ id: 'n1', type: 't1' }],
      edges: [{ id: 'e1', source: 'n1', target: 'n2' }],
    }
    const c = {
      nodes: [{ id: 'n1', type: 't1' }],
      connections: [{ id: 'e1', source: 'n1', target: 'n2' }],
    }
    expect(hashWorkflowDefinition(e)).toBe(hashWorkflowDefinition(c))
  })

  test('null-ish or malformed inputs do not throw', () => {
    expect(() => hashWorkflowDefinition({} as any)).not.toThrow()
    expect(() => hashWorkflowDefinition({ nodes: null } as any)).not.toThrow()
    expect(() => hashWorkflowDefinition({ nodes: [null, undefined] } as any)).not.toThrow()
    expect(() => hashWorkflowDefinition({ nodes: [{ id: null }] } as any)).not.toThrow()
  })

  test('hash is hex SHA-256 (64 chars)', () => {
    const w = {
      nodes: [{ id: 'n1', type: 't1', config: { a: 1 } }],
      edges: [],
    }
    const h = hashWorkflowDefinition(w)
    expect(h).toMatch(/^[0-9a-f]{64}$/)
  })

  test('two semantically different workflows do not collide on hash', () => {
    const a = { nodes: [{ id: 'n1', type: 'gmail' }], edges: [] }
    const b = { nodes: [{ id: 'n1', type: 'slack' }], edges: [] }
    expect(hashWorkflowDefinition(a)).not.toBe(hashWorkflowDefinition(b))
  })
})
