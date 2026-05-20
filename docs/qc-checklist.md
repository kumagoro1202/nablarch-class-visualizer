# Pre-Merge QC Checklist

This checklist must be verified before merging any PR that touches visualization logic, layout settings, or node/edge rendering.

## Local Verification Steps

1. **Build succeeds**
   ```bash
   cd viewer && npm run build
   ```
   Expected: `✓ built in Xms` with no errors.

2. **Serve is running**
   ```bash
   # Ensure serve is active on port 5000
   curl -s -o /dev/null -w "%{http_code}" http://localhost:5000/
   ```
   Expected: `200`

3. **Open the viewer** at http://localhost:5000/ and verify:

   | Item | Expected |
   |------|----------|
   | Node layout | Organic/clustered arrangement (NOT grid-like rows/columns) |
   | Node colors | Each artifact group has a distinct color (NOT all similar blue) |
   | Edges | Visible connections between related nodes |
   | Legend panel | Colors in legend match colors of actual nodes |
   | Search | Typing a class name highlights matching nodes |
   | Filter | Toggling an artifact checkbox dims/shows its nodes |
   | Detail panel | Clicking a node shows class details |
   | N-level expand | Expand mode shows connected nodes step by step |

4. **Console check**
   Open browser DevTools → Console. No red errors should appear on initial load.

## Regression Risk Areas

- `cy.layout({...})` parameter changes → always verify organic layout
- `hashArtifactColor` changes → always verify color diversity across artifact groups
- LOD compound node logic → verify N-level expand still works
- Edge opacity logic → verify edges are visible at default zoom

## Sign-off

Before requesting review, the author confirms:
- [ ] `npm run build` passed
- [ ] Viewed at http://localhost:5000/ and layout is non-grid
- [ ] Node colors are visually distinct per artifact
- [ ] No console errors on load
