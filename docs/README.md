# macup docs

This index maps the docs tree to the four Diataxis modes (tutorial, how-to, reference,
explanation), plus the spec, decision, and template sets that sit alongside them. One fact
has one home; everything else links to it.

## Spec and PRD

What macup does and why, with acceptance conditions.

- [PRD.md](PRD.md): the product requirements, scope, and acceptance for the CLI.

## Reference

Lookup material: contracts, manifests, and the command surface.

- [../apps/cli/plugins/README.md](../apps/cli/plugins/README.md): the plugin authoring contract (the
  `Plugin` shape, manifest fields, error handling, pins and skip).
- The CLI `--help`: run `macup --help` for the live command, flag, and subcommand
  reference. It is generated from the plugin manifests, so it stays in step with the code.

## How-to

Task-oriented steps for getting something done.

- [Quick start](../README.md#quick-start): the common flows (wizard, list outdated,
  update everything, add and pin packages, config status, restore a backup).

## Strategy

How the project decides what to test and how.

- [TESTING_STRATEGY.md](TESTING_STRATEGY.md): the testing approach across unit,
  integration, and regression layers.

## Decisions

The decision trail. One numbered record per significant decision: context, decision,
alternatives, consequences.

- [adr/](adr/): the Architecture Decision Records.

## Templates

Starting points for new docs. Copied verbatim from the engineering playbook.

- [templates/feature-spec.md](templates/feature-spec.md): a feature spec.
- [templates/design-doc.md](templates/design-doc.md): a design doc, reviewed before build.
- [templates/prd.md](templates/prd.md): a product or feature PRD.

## Working notes

Specs and plans produced during feature work with the superpowers workflow.

- [superpowers/specs/](superpowers/specs/): design specs from feature work.
- [superpowers/plans/](superpowers/plans/): implementation plans from feature work.
