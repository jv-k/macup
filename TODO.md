# TODO

## High Priority Features

- [ ] **Rename App!**: Rename app to `mac-updater`.
- [ ] **'Tracked' keyword**: Ensure this distinction between packages tracked by the package manager
      and those manually installed is reflected throughout interactions with the user.
- [x] **Context aware help system**: Improve help system to provide context-aware assistance.
  - [x] Show relevant commands based on resource type, showing context-specific syntax.
  - [x] Display available sub-commands for list/install/update.
  - [x] Provide examples based on context.
- [x] **Backup/restore**: Create backups of current package states.
  - [x] Automatic timestamped backups before add/remove/install operations
  - [x] Smart backup optimization (only keep backups when changes occur)
  - [x] Cleanup command with user confirmation
  - [x] Integration with existing commands
  - [ ] Restore functionality (future enhancement)
- [ ] **Dry run mode**: Show what would be updated without making changes.
- [ ] **Rollback capability**: Undo recent package changes (?)

## Next Priority Features

- [ ] **Python system-wide package support**: Add support for pip packages.

  - [ ] **List installed packages**: Show all installed pip packages.
  - [ ] **Update packages**: Update all or specific pip packages.
  - [ ] **Install packages**: Install new pip packages from requirements.txt.

- [ ] **Interactive CLI GUI mode**:

  - [ ] **Selective updates**: Interactive mode to choose which packages to update.
  - [ ] Use `fzf` or similar for interactive package selection.
  - [ ] UI with panes for package types, details, and system info.
  - [ ] Navigate and select packages to update/install/remove.
  - [ ] Preview package details before actions.
  - [ ] Confirm selections before applying changes.
  - [ ] System info page, showing as per below metrics.

- [ ] **System Info**: Display system information relevant to package management:

  - [ ] **OS Information**: Show details about the operating system.
  - [ ] **System Architecture**: Display information about the system architecture (e.g., x86_64, arm64).
  - [ ] **Installed Package Managers**: List all available package managers.
  - [ ] **Disk Space**: Current disk space used for all + per package manager.

- [ ] **Plugin System**: Allow for community-contributed plugins to extend functionality.
  - [ ] Define a plugin architecture with clear guidelines.
  - [ ] Implement a system for loading and managing plugins.
  - [ ] Create a tag for sharing plugins.
  - [ ] Document how to create and use plugins.
  - [ ] Convert existing features (e.g., npm and pip support) into plugins.

## Medium Priority Features

- [ ] **Starter config**: Put template into external file.
- [ ] **Update/Install/Add/Remove**: Align all UI columns for consistency.
- [ ] **Improve `manage_applist` messages**:
  - [ ] **Add task title**: Include the action being performed (e.g., "Adding", "Removing").
  - [ ] **Refine messages**: success and error messages for clarity and consistency.
- [ ] **Send notifications**: Notify user of completed updates via system notifications using `terminal-notifier`.
- [ ] **Performance**: Cache package information to reduce API calls (?)
- [ ] **Configuration management**: Multiple config file support (?)
- [ ] **Custom package sources**: Support for additional package managers.
- [ ] **Parallel processing**: Run multiple package managers simultaneously.
- [ ] **Update scheduling**: Cron-like scheduling for automatic updates.
- [ ] **Package name completion**: Tab complete actual package names for add/remove commands.
- [ ] **Package Installs** Change symbol to '+'.
- [ ] **Package Removals** Change symbol to '-'.
- [ ] **Logo Text**: Create separate package to render large ASCII art logos.
- [ ] **Self-update**: Add ability to update the tool itself.

## Code Quality & Development

- [x] **Testing**: Add comprehensive test suite (unit, integration, e2e, config, completions).
- [x] **Linting**: Add shellcheck linting with pnpm scripts.
- [x] **Auto-fix capability**: Added automated shellcheck fix application.
- [x] **Development scripts**: Added lint helpers, auto-fix, and validation scripts.
- [x] **Modularization**: Complete separation of concerns into dedicated modules (applist.zsh, helpsystem.zsh, messages.zsh, pkgutils.zsh, resources.zsh, utils.zsh).
- [x] **Advanced test infrastructure**: BATS-based testing with comprehensive coverage and CI-ready configuration.
- [x] **Enhanced npm scripts**: Complete development workflow automation with granular test control.
- [ ] **CI/CD**: GitHub Actions for testing and releases.
- [ ] **Documentation**: Add JSDoc comments throughout.

## Performance & Configuration

- [ ] **Logging**: Optional detailed logging to file.
- [ ] **Configuration**: Generate JSON configuration files.

## Recently Completed ✅

- [x] **Bug: version/description/name in help**: Fix incorrect version/description/name in help output, due to CWD issue.
- [x] **Multiple package support**: Added ability to add/remove multiple packages in single commands.
- [x] **Environment variable config override**: Added MACOS_UPDATETOOL_CONFIG for safe testing.

- [x] **Comprehensive testing infrastructure**:

  - [x] BATS test framework integration.
  - [x] Unit tests for CLI, multiple packages, and core functionality.
  - [x] Integration tests for workflows and real command execution.
  - [x] End-to-end tests for complete scenarios.
  - [x] Configuration validation tests.
  - [x] Shell completion tests with syntax validation.

- [x] **Advanced linting and validation**:

  - [x] Shellcheck integration with bash compatibility mode.
  - [x] Automated fix application with `lint:fix:patch`.
  - [x] Zsh syntax validation.
  - [x] Multiple helper scripts for linting and fixing.

- [x] **Configuration validation**: JSON schema validation with ajv.
- [x] **Documentation improvements**: Added detailed technical articles.
- [x] **Development workflow**: Added setup scripts and development helpers.

- [x] **Complete modular architecture refactor**:
  - [x] **Message system separation** (`messages.zsh`): Centralized output formatting with consistent styling.
  - [x] **Package management separation** (`pkgutils.zsh`): Isolated all package manager interactions.
  - [x] **Help system separation** (`helpsystem.zsh`): Dynamic context-aware help generation.
  - [x] **Resource management separation** (`resources.zsh`): Centralized resource type definitions and mappings.
  - [x] **Application list management separation** (`applist.zsh`): Dedicated configuration file management.
  - [x] **Utility functions separation** (`utils.zsh`): Common utilities and error handling.

## Previously Completed ✅

- [x] **Extract shared logic from list functions**: Eliminated code duplication across package listing operations.
- [x] **Move Xcode functions to dedicated modules**: Separated Xcode-specific functionality into focused modules.
- [x] **Remove redundant wrapper functions**: Cleaned up unnecessary function abstractions.
- [x] **Create standalone npm package**: Established proper npm package structure and distribution.
- [x] **Preserve Git history during extraction**: Maintained commit history through major refactoring.
- [x] **Add comprehensive README**: Created detailed project documentation.
- [x] **Set up proper project structure**: Organized codebase with logical directory hierarchy.
- [x] **Modern CLI Interface**: Implemented resource-centric syntax (`<resource-type> <command>`).
- [x] **Comprehensive argument parsing**: Centralized validation with proper error handling.
- [x] **Context-aware shell completions**: Intelligent tab completion for all commands.
- [x] **Resource-specific command support**: Different commands available per resource type.
- [x] **Smart "outdated" filtering**: Intelligent exclusion of incompatible resources.
- [x] **Help system**: Comprehensive help documentation with examples.
- [x] **Command validation**: Proper validation of command/resource combinations.
- [x] **Install/update/list separation**: Clean separation of concerns for different operations.
- [x] **All resource type**: Smart handling of bulk operations across multiple resource types.
- [x] **Configuration validation**: Added --config switch with YAML validation and status checking.
- [x] **Update notifications**: Added --version switch showing tool version, author, and website info.
- [x] **Package search**: Can search/list packages across all sources with comprehensive filtering.
- [x] **Error handling**: Significantly improved error messages with clear usage guidance and styling.
- [x] **Progress indicators**: Added detailed package counters (1/43 style) for all update/install operations.
