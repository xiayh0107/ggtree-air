# Frontend design baseline

The report is a scientific node-based workflow, not a dashboard skin. Its visual
language is informed by the reference node canvas. The implementation uses
React 19, TypeScript, and `@xyflow/react`; the compiled bundle is inlined into
the standalone report so users do not need a separate frontend server.

## Applied principles

- **Workflow UI:** expose only artifact → human instruction → artifact. Input
  validation, routing, and caveats belong to details/logs, not permanent canvas
  nodes.
- **Fluid functionalism:** animation only explains state change—drawer entry,
  selection, hover actions, toast confirmation, pan/zoom. No ambient motion.
- **Hero-style systems:** one token set, predictable spacing, focus states,
  accessible labels, and reusable button/node/drawer primitives.
- **beUI-style liveliness:** short, restrained transitions make direct
  manipulation feel responsive while respecting reduced-motion preferences.
- **3D/WebGL restraint:** tree inspection needs exact coordinates and readable
  labels; WebGL is not used unless a future high-density topology view has a
  measured need for it.

## Non-negotiable rules

- This is a **node-based workflow**, not a latest-result dashboard: feedback is a
  workflow node and every rerender creates new downstream artifact nodes.
  Previous artifact nodes remain visible, immutable, and read-only.
- Content is primary; static chrome stays quiet.
- White nodes, light gray canvas, `#1769E0` primary, no decorative gradients.
- Node cards use 16px corners. The node-local composer handles ordinary edits;
  the right drawer is reserved for large preview and optional visual selection.
- Every visible status comes from workspace/renderer data.
- Tip/clade markers come from `scene.json`, never from DOM or pixel guessing.
- Shift-click and Shift-marquee create a temporary multi-selection; selected
  nodes move together and feed one Agent Task without creating a persistent group.
- Mutations remain usable by keyboard and expose labels/titles.
- Offline mode must be honest about browser write restrictions.
