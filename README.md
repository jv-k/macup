# macos-updatetool

A comprehensive CLI tool that tracks and manages apps and packages on macOS from multiple sources including Homebrew, npm, Mac App Store, Xcode, and system updates.

## Features

- **🍺 Homebrew**: Manage formulas and casks with intelligent updating
- **📦 NPM**: Handle global Node.js packages with progress tracking
- **🏪 App Store**: Update and manage Mac App Store applications
- **🔨 Xcode**: Keep Xcode and command-line tools current
- **🖥️ System**: Manage macOS system updates and tools
- **⚡ Smart Operations**: Bulk operations with user confirmation and progress indicators
- **🎯 Resource-Centric**: Modern CLI syntax with intuitive resource-based commands
- **🔧 Shell Completions**: Intelligent tab completion for all commands and options
- **📋 Configuration**: YAML-based package tracking with validation
- **💾 Automatic Backups**: Configuration automatically backed up before changes with smart cleanup

## Installation

```bash
# Homebrew
brew tap jv-k/macos-updatetool
brew install macos-updatetool

# NPM
npm install -g macos-updatetool

# Or clone and install locally
git clone https://github.com/jv-k/macos-updatetool.git
cd macos-updatetool
pnpm install
```

## Quick Start

```bash
# Show help and available commands
macos-updatetool help

# List all packages from all sources
macos-updatetool all list

# Show only outdated packages (smart filtering)
macos-updatetool all list outdated

# Update all outdated packages with confirmation
macos-updatetool all update

# Add a Homebrew formula to your configuration
macos-updatetool brew formulas add git

# Add multiple Homebrew formulas at once
macos-updatetool brew add git node bats-core

# Add a Homebrew cask to your configuration
macos-updatetool brew casks add visual-studio-code

# Add multiple casks at once
macos-updatetool brew casks add firefox chrome docker

# Add multiple npm packages at once
macos-updatetool npm add typescript eslint nodemon

# Update only outdated npm packages
macos-updatetool npm update outdated
```

## CLI Syntax

The tool uses a modern resource-centric syntax:

```text
macos-updatetool <resource-type> [resource-subtype] <command> [sub-command] [pkg-name...]
```

### Resource Types

- `brew` - Homebrew formulas and casks
- `npm` - Global NPM packages
- `appstore` - Mac App Store applications
- `xcode` - Xcode IDE
- `system` - macOS system updates and Xcode command-line tools
- `all` - All supported resource types

### Commands

- `list` - Display packages and their installation status
- `install` - Install specified or all tracked packages
- `update` - Update specified or all tracked packages
- `add` - Add a package to the configuration file
- `remove` - Remove a package from the configuration file

### Sub-commands

- `outdated` - Restrict to only outdated packages (brew, npm, appstore, all)
- `all` - Apply to all tracked packages (default)

## Configuration

The tool uses a YAML configuration file located at:

```text
~/.config/macos-updatetool/applist.yaml
```

Example configuration:

```yaml
appstore:
  - 497799835 # Xcode
  - 1295203466 # Microsoft Remote Desktop

npm:
  - typescript
  - '@vue/cli'
  - nodemon

brew:
  - git
  - curl
  - jq

cask:
  - visual-studio-code
  - firefox
  - docker
```

### Configuration Management

```bash
# Check configuration status and validation
macos-updatetool --config

# Validate configuration with detailed schema checking
pnpm run config:check
```

## Configuration Backup System

The tool automatically creates timestamped backups of your configuration before any modifications:

### Automatic Backups

- **When**: Backups are created automatically before `add`, `remove`, and `install` operations
- **Where**: Stored in `~/.config/macos-updatetool/backups/`
- **Format**: `applist_<operation>_YYYY-MM-DD_HH-MM-SS.yaml`
- **Smart**: Only keeps backups when actual changes occur (removes backup if no changes made)

### Backup Management

```bash
# Clean up all backup files (with confirmation prompt)
macos-updatetool --cleanup

# Backup files are automatically created, for example:
# ~/.config/macos-updatetool/backups/applist_add_2024-03-15_14-30-22.yaml
# ~/.config/macos-updatetool/backups/applist_install_2024-03-15_14-35-18.yaml
```

### Backup Examples

```bash
# These operations automatically create backups:
macos-updatetool brew add git           # Creates applist_add_*.yaml
macos-updatetool npm remove typescript  # Creates applist_remove_*.yaml
macos-updatetool all install           # Creates applist_install_*.yaml

# Clean up when you have too many backups:
macos-updatetool --cleanup              # Interactive cleanup with confirmation
```

## Shell Completions

Install intelligent tab completions for your shell:

```bash
# Generate completion script
macos-updatetool completions > ~/.zsh/completions/_macos-updatetool

# Add to your .zshrc
echo 'fpath=(~/.zsh/completions $fpath)' >> ~/.zshrc
echo 'autoload -U compinit && compinit' >> ~/.zshrc
```

## Development

### Prerequisites

```bash
# Install development dependencies
brew install shellcheck bats-core
pnpm install
```

### Testing

The project includes a comprehensive test suite designed specifically for zsh:

```bash
# Run all tests with zsh-specific linting
pnpm run test:all

# Run zsh-specific linting
pnpm run lint                    # Comprehensive zsh linting
pnpm run lint:shellcheck        # ShellCheck with zsh configuration
pnpm run lint:syntax           # Zsh syntax validation

# Run specific test types
pnpm run test:unit              # Unit tests
pnpm run test:integration       # Integration tests
pnpm run test:e2e              # End-to-end user scenarios
pnpm run test:config           # Configuration tests
pnpm run test:completions      # Zsh completion tests

# Validate configuration
pnpm run config:check

# Setup development environment
pnpm run dev:setup
```

### Zsh-Specific Development

This project is built specifically for zsh and includes:

- **Zsh syntax validation**: Ensures compatibility with zsh-specific features
- **ShellCheck with zsh configuration**: Tailored linting rules for zsh
- **Zsh completion testing**: Validates completion scripts work in zsh environment
- **Zsh-specific test helpers**: Test utilities designed for zsh behavior

### Test Structure

```text
test/
├── unit/              # Unit tests for individual functions
├── integration/       # Integration tests for command workflows
├── e2e/              # End-to-end user scenarios
├── config/           # Configuration and YAML validation tests
├── completions/      # Shell completion functionality tests
├── fixtures/         # Test data and mock configurations
└── test_helper.bash  # Shared test utilities and setup
```

### Available Scripts

```bash
pnpm run lint              # Comprehensive zsh linting (syntax + shellcheck + best practices)
pnpm run lint:shellcheck   # ShellCheck with bash compatibility mode
pnpm run lint:syntax       # Zsh syntax validation only
pnpm run lint:detailed     # Detailed linting output (gcc format)
pnpm run lint:help         # Show guidance for fixing common linting issues
pnpm run lint:autofix      # Automatically fix safe, mechanical transformations
pnpm run config:check      # Validate YAML configuration schema
pnpm run test             # Run basic test suite
pnpm run test:all         # Run comprehensive test suite with zsh linting
pnpm run dev:setup        # Install development dependencies and setup
```

## Examples

### Resource-Specific Operations

```bash
# Homebrew operations
macos-updatetool brew list                    # List all brew packages
macos-updatetool brew casks list outdated    # List outdated casks only
macos-updatetool brew formulas update        # Update all formulas
macos-updatetool brew casks add firefox      # Add single cask to configuration
macos-updatetool brew add git node bats-core # Add multiple formulas at once
macos-updatetool brew casks add firefox chrome docker # Add multiple casks at once

# NPM operations
macos-updatetool npm list outdated           # Show outdated global packages
macos-updatetool npm update outdated         # Update only outdated packages
macos-updatetool npm add typescript          # Add single package to configuration
macos-updatetool npm add typescript eslint jest # Add multiple packages at once

# App Store operations
macos-updatetool appstore list               # List App Store apps
macos-updatetool appstore update             # Update all App Store apps
macos-updatetool appstore add 497799835      # Add app by ID

# System operations
macos-updatetool system list                 # Show system update status
macos-updatetool xcode update                # Update Xcode
```

### Bulk Operations

```bash
# Smart "all" operations with confirmation prompts
macos-updatetool all list                    # List everything
macos-updatetool all list outdated          # Smart outdated filtering (excludes xcode/system)
macos-updatetool all update                 # Update everything (requires confirmation)
macos-updatetool all install                # Install all configured packages
```

## Troubleshooting

### Common Issues

1. **Dependencies**: Ensure Homebrew, mas-cli, and npm are installed
2. **Permissions**: Some operations may require administrator privileges
3. **Configuration**: Use `macos-updatetool --config` to check YAML syntax
4. **Testing**: Run `pnpm run test:all` to verify functionality

### Debug Information

```bash
# Check tool version and information
macos-updatetool --version

# Validate configuration file
macos-updatetool --config

# Test shell completions
macos-updatetool completions | head -20

# Clean up backup files if needed
macos-updatetool --cleanup
```

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature-name`
3. Make changes and add tests: `pnpm run test:all`
4. Ensure linting passes: `pnpm run lint`
5. Commit changes: `git commit -am 'Add feature'`
6. Push to branch: `git push origin feature-name`
7. Submit a pull request

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Author

**John Valai** - [git@jvk.to](mailto:git@jvk.to)

---

## More Information

- [CLI Syntax Reference](docs/cli-syntax.md)
- [Development TODO](TODO.md)
- [Issue Tracker](https://github.com/jv-k/macos-updatetool/issues)
