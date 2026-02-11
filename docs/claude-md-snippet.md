# kt Integration Snippet for CLAUDE.md

Copy the section below into any project's CLAUDE.md to enable knowledge tracker integration.

---

## Knowledge System

You have access to `kt` (knowledge tracker). Use it:

- **At session start:** Context is auto-loaded via hook. Check for any knowledge brief in the session context.
- **During conversation:** When you encounter a client name, strategic concept, or domain you may have prior knowledge about, run `kt search "<topic>"` before proceeding. Surface findings briefly, don't dump.
- **After meaningful work:** Suggest `/capture` if decisions were made or insights emerged worth persisting. Each capture should be self-contained — readable without the current session context.

### Quick Reference

```bash
kt search "<query>"                    # Find relevant knowledge
kt capture "<content>" -n <namespace>  # Save knowledge
kt context                             # Load full context brief
kt show <id> --with-links              # Inspect a specific node
```
