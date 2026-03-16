# Stella Session Prompt

Copy everything below the line into your first message in the new Claude Code session connected to https://github.com/jetskicortez/Stella

---

I want to port my entire listing workflow from Claude Co-Work to Claude Code so everything runs locally and is as automated as possible.

**Current workflow (Claude Co-Work):** When I get a new commercial real estate listing, Co-Work creates the folder structure in my Google Drive for Desktop, grabs templates, fills in the listing agreement, and produces the offering memorandum PowerPoint — all based on property/building info and due diligence docs I provide.

**Goal:** Automate the full workflow through Claude Code so that when I get a new listing, all I have to do is drop in the property info, building info, and due diligence documents, and everything gets created at once — folder structure, listing agreement, offering memorandum PPTX, and a retailer trade area map (generated from my retailer-map app).

**Before doing anything, review these locations:**

1. **My Google Drive listings folder** (local path: `C:\Users\Jetsk\My Drive\3 - Claude Cowork - CRE`) — review the folder structure, templates, completed listing examples, and any .md files that define the workflow
2. **The retailer-map repo** at `C:\Users\Jetsk\retailer-map` — this generates trade area maps with BrandFetch logos and exports PNG/PDF
3. **This repo** (Stella) at https://github.com/jetskicortez/Stella — this is the new home for the automation workflow

Review all files thoroughly, then present a plan before writing any code.

**Deliverables:**

1. An MCP server that wraps the retailer-map app so Claude Code can generate maps on demand
2. A Claude Code workflow that replaces my Co-Work setup
3. The full pipeline: new listing → folder creation → templates filled → offering memorandum PPTX with embedded retailer map → listing agreement
