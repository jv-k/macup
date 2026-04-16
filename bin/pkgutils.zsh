#!/bin/zsh

# Package Management Utilities Module —  TEMPORARY
#
# Purpose:
# - Provide comprehensive package management operations for all supported resource types.
# - Handle installation, updating, and status checking across multiple package managers.
# - Ensure consistent user experience with progress indicators and error handling.
# - Support both individual and bulk operations with appropriate confirmation prompts.
#
# Responsibilities:
# - Execute package operations for Homebrew (formulas and casks), npm, Mac App Store, and system tools.
# - Provide detailed progress feedback with counters and status indicators.
# - Handle package status categorization (up-to-date, outdated, not installed).
# - Integrate with applist configuration for tracking user-specified packages.
# - Perform health checks and diagnostics after package operations.
# - Support filtered operations (e.g., outdated-only listings).
##
# Public functions (used by main script):
# - update_*() functions         : update packages for each resource type
# - install_*() functions        : install packages for each resource type  
# - list_*() functions          : display package status with filtering options
# - update_all()                : comprehensive update across all resource types
# - install_all()               : comprehensive installation across all resource types
#
# Features:
# - **Progress tracking**: Shows current item (N/total) for batch operations
# - **Status categorization**: Groups packages as up-to-date, outdated, or not installed
# - **Health diagnostics**: Runs package manager health checks after operations
# - **Error resilience**: Continues processing even if individual packages fail
# - **Filtered display**: Supports showing only outdated packages when requested
# - **Integration**: Works seamlessly with applist configuration and messaging system
#
# Author: John Valai <git@jvk.to>
# License: MIT License

source "${MODULE_DIR}/styles.zsh"

# Upgrades App Store applications defined in applist configuration to their latest versions.
# Processes all configured App Store apps, showing progress indicators for each upgrade.
# Includes comprehensive health checks and displays information about untracked outdated apps.
# Integrates with system update checks to provide complete macOS update visibility.
# @returns {number} 0 on success, 1 on error
update_appstore() {
  local -a appstore_apps
  appstore_apps=("${(@f)$(get_applist_packages "appstore_apps")}")
  
  # Skip if no apps configured
  if [[ ${#appstore_apps[@]} -eq 0 ]]; then
    msg_info "No App Store apps configured in applist - skipping.\n"
    return 0
  fi
  
  msg_header --underline --upper "\nUpdating App Store apps" "(${#appstore_apps[@]}):"
  echo
  show_spinner "  Updating $(style_wrap GREEN "mas")" "brew -v upgrade mas"
  echo

  local counter=1
  for app in "${appstore_apps[@]}"; do
    show_spinner "  $(style_wrap DIM "${counter}/${#appstore_apps[@]}") Updating $(style_wrap GREEN "${app}")" "mas upgrade \"${app}\""
    ((counter++))
  done

  # FINISH UP: Check for any remaining outdated apps and system updates.
  echo
  local temp_outdated
  temp_outdated=$(mktemp)
  mas outdated > "${temp_outdated}" 2>/dev/null
  
  if [[ -s "${temp_outdated}" ]]; then
    show_spinner --show-output "  Check for all outdated $(style_wrap GREEN "App Store") apps" "cat \"${temp_outdated}\""
    echo
    msg_info --italic "    These apps aren't in your applist.yaml and won't be auto-updated."
  else
    msg_success "  All App Store apps are up to date!"
  fi
  
  rm -f "${temp_outdated}"
  echo
  show_spinner --show-output "  Check for $(style_wrap GREEN "MacOS") updates" "softwareupdate list"
}

# Installs applications from the Mac App Store based on applist configuration.
# Processes each configured app sequentially with progress tracking and status feedback.
# Integrates with mas-cli to handle App Store authentication and installation workflows.
# @returns {number} 0 on success, 1 on error
install_appstore_apps() {
  local -a appstore_apps
  appstore_apps=("${(@f)$(get_applist_packages "appstore_apps")}")
  
  # Skip if no apps configured
  if [[ ${#appstore_apps[@]} -eq 0 ]]; then
    msg_info "No App Store apps configured in applist - skipping.\n"
    return 0
  fi
  
  msg_header --underline --upper "Installing App Store apps" "(${#appstore_apps[@]}):"
  echo
  local counter=1
  for app in "${appstore_apps[@]}"; do
    show_spinner "  $(style_wrap DIM "${counter}/${#appstore_apps[@]}") Installing $(style_wrap GREEN "${app}")" "mas install \"${app}\""
    ((counter++))
  done
}

# Updates globally installed npm packages listed in applist configuration.
# First updates npm itself to the latest version, then processes each configured package.
# Includes npm health diagnostics after all operations to verify system integrity.
# Provides sequential progress indicators showing current package N/total being processed.
# @returns {number} 0 on success, 1 on error
update_npm() {
  local -a npm_apps
  npm_apps=("${(@f)$(get_applist_packages "npm_apps")}")
  
  # Skip if no apps configured
  if [[ ${#npm_apps[@]} -eq 0 ]]; then
    msg_info "No npm packages configured in applist - skipping.\n"
    return 0
  fi
  
  msg_header --underline --upper "\nUpdating NPM apps" "(${#npm_apps[@]}):"
  echo
  # Update npm itself
  show_spinner "  Updating $(style_wrap GREEN "npm") itself" "npm update -g npm"
  echo
  local counter=1
  for app in "${npm_apps[@]}"; do
    show_spinner "  $(style_wrap DIM "${counter}/${#npm_apps[@]}") Updating $(style_wrap GREEN "${app}")" "npm update -g \"${app}\""
    ((counter++))
  done
  
  # FINISH UP: Run npm doctor to check for any issues.
  # ---------
  echo
  show_spinner --show-output "  Checking $(style_wrap GREEN "NPM health")" "npm doctor"
}

# Installs globally installed npm packages from applist configuration.
# Processes each configured package sequentially with progress tracking and status feedback.
# Includes npm health diagnostics after installation to verify system integrity and functionality.
# Provides clear feedback if no packages are configured to avoid unnecessary processing.
# @returns {number} 0 on success, 1 on error
install_npm_apps() {
  local -a npm_apps
  npm_apps=("${(@f)$(get_applist_packages "npm_apps")}")
  
  # Skip if no apps configured
  if [[ ${#npm_apps[@]} -eq 0 ]]; then
    msg_info "No npm packages configured in applist - skipping.\n"
    return 0
  fi
  
  msg_header --underline --upper "Installing NPM apps" "(${#npm_apps[@]}):"
  echo
  local counter=1
  for app in "${npm_apps[@]}"; do
    show_spinner "$(style_wrap DIM "${counter}/${#npm_apps[@]}") Installing $(style_wrap GREEN "${app}")" "npm install -g \"${app}\""
    ((counter++))
  done
  # FINISH UP: Run npm doctor to check for any issues.
  # ---------
  echo
  show_spinner --show-output "Checking $(style_wrap GREEN "NPM health")" "npm doctor"
}

# Updates Homebrew formulas listed in applist configuration to their latest versions.
# First updates the Homebrew repository index, then processes each configured formula.
# Includes brew health diagnostics after all operations to verify system integrity.
# Provides sequential progress indicators showing current formula N/total being processed.
# @returns {number} 0 on success, 1 on error
update_formulas() {
  local -a brew_apps
  brew_apps=("${(@f)$(get_applist_packages "brew_formulas")}")
  
  # Skip if no apps configured
  if [[ ${#brew_apps[@]} -eq 0 ]]; then
    msg_info "No brew formulas configured in applist - skipping.\n"
    return 0
  fi
  
  msg_header --underline --upper "\nUpdating Brew formulas" "(${#brew_apps[@]}):"
  echo
  show_spinner "Updating Homebrew" "brew update"
  echo
  local counter=1
  for app in "${brew_apps[@]}"; do
  	show_spinner "$(style_wrap DIM "${counter}/${#brew_apps[@]}") Upgrading $(style_wrap GREEN "${app}")" "brew upgrade \"${app}\""
  	((counter++))
  done
  # FINISH UP: Run brew doctor
  echo
  show_spinner --show-output "Checking $(style_wrap GREEN "Brew health")" "brew doctor"
}

# Installs Homebrew formulas from applist configuration.
# Updates the Homebrew repository index first, then processes each configured formula.
# Includes brew health diagnostics after all operations to verify system integrity.
# Provides sequential progress indicators showing current formula N/total being processed.
# @returns {number} 0 on success, 1 on error
install_formulas() {
  local -a brew_apps
  brew_apps=("${(@f)$(get_applist_packages "brew_formulas")}")
  
  # Skip if no apps configured
  if [[ ${#brew_apps[@]} -eq 0 ]]; then
    msg_info "No brew formulas configured in applist - skipping.\n"
    return 0
  fi
  
  msg_header --underline --upper "Installing Brew formulas" "(${#brew_apps[@]}):"
  echo
  show_spinner "Updating Homebrew" "brew update"
  echo
  local counter=1
  for app in "${brew_apps[@]}"; do
  	show_spinner "$(style_wrap DIM "${counter}/${#brew_apps[@]}") Installing $(style_wrap GREEN "${app}")" "brew install \"${app}\""
  	((counter++))
  done
  # FINISH UP: Run brew doctor
  echo
  show_spinner --show-output "Checking $(style_wrap GREEN "Brew health")" "brew doctor"
}

# Updates Homebrew casks listed in applist configuration to their latest versions.
# First updates the Homebrew repository index, then processes each configured cask.
# Includes brew health diagnostics after all operations to verify system integrity.
# Provides sequential progress indicators and warns users about potentially needing to close applications.
# @returns {number} 0 on success, 1 on error
update_casks() {
  local -a cask_apps
  cask_apps=("${(@f)$(get_applist_packages "brew_casks")}")
  
  # Skip if no apps configured
  if [[ ${#cask_apps[@]} -eq 0 ]]; then
    msg_info "No brew casks configured in applist - skipping.\n"
    return 0
  fi
  
  msg_header --underline --upper "\nUpgrading Brew Casks" "(${#cask_apps[@]}):"
  echo
  msg_warning --italic "You may need to close the apps for updates to apply."
  echo
  
  show_spinner "Updating Homebrew" "brew update"
  echo
  local counter=1
  for app in "${cask_apps[@]}";  do
  	show_spinner "$(style_wrap DIM "${counter}/${#cask_apps[@]}") Upgrading $(style_wrap GREEN "${app}")" "brew upgrade --cask \"${app}\""
  	((counter++))
  done
  # FINISH UP: Run brew doctor
  echo
  show_spinner --show-output "Checking $(style_wrap GREEN "Brew health")" "brew doctor"
}

# Installs Homebrew casks listed in applist configuration.
# Updates the Homebrew repository index first, then processes each configured cask.
# Includes brew health diagnostics after all operations to verify system integrity.
# Provides sequential progress indicators showing current cask N/total being processed.
# @returns {number} 0 on success, 1 on error
install_casks() {
  local -a cask_apps
  cask_apps=("${(@f)$(get_applist_packages "brew_casks")}")
  
  # Skip if no apps configured
  if [[ ${#cask_apps[@]} -eq 0 ]]; then
    msg_info "No brew casks configured in applist - skipping.\n"
    return 0
  fi
  
  msg_header --underline --upper "Installing Brew Casks" "(${#cask_apps[@]}):"
  echo
  
  local counter=1
  for app in "${cask_apps[@]}"; do
  	show_spinner "$(style_wrap DIM "${counter}/${#cask_apps[@]}") Installing $(style_wrap GREEN "${app}")" "brew install --cask \"${app}\""
  	((counter++))
  done
  # FINISH UP: Run brew doctor
  echo
  show_spinner --show-output "Checking $(style_wrap GREEN "Brew health")" "brew doctor"
}

# Updates Xcode Command Line Tools to the latest available version.
# Checks for existing installation and available updates via softwareupdate.
# Provides installation progress feedback and displays current version information.
# Handles timeout scenarios for potentially long-running system update operations.
# @returns {number} 0 on success, 1 on error
update_xcode_tools() {
  msg_header --underline --upper "\nUpdating Xcode Command Line Tools:"
  echo
  
  # Check if Command Line Tools are installed
  if ! xcode-select -p &> /dev/null; then
    msg_warning "Command Line Tools not installed. Exiting..."
    return 1
  fi
  
  # Check for and install any Command Line Tools updates
  local xcode_update_label
  xcode_update_label=$(softwareupdate list 2>/dev/null | grep -i "command line tools" | grep "Label:" | sed 's/^[[:space:]]*\*[[:space:]]*Label:[[:space:]]*//' || true)

  if [[ -n "${xcode_update_label}" ]]; then
    msg_info "Found Command Line Tools to update: ${xcode_update_label}"
    show_spinner "Installing $(style_wrap GREEN "Command Line Tools") update" "softwareupdate --install \"${xcode_update_label}\" --verbose" 120
  else
    msg_success "Command Line Tools are already up to date."
  fi
  
  # Show current version info
  echo
  msg_info "Current version: $(style_wrap GREEN "$(xcode-select --version)")"  
  msg_info "Current path: $(style_wrap GREEN "$(xcode-select --print-path)")"
}

# Installs Xcode Command Line Tools if not already present.
# Checks for existing installation before attempting installation to avoid unnecessary prompts.
# Provides clear progress feedback and waits for installation completion with verification.
# Displays version and path information upon successful installation.
# @returns {number} 0 on success, 1 on error
install_xcode_tools() {
  msg_header --underline --upper "\nInstalling Xcode Command Line Tools:"
  echo
  
  # Check if Command Line Tools are already installed
  if xcode-select -p &> /dev/null; then
    msg_success "Command Line Tools are already installed."
    msg_info "Current version: $(style_wrap GREEN "$(xcode-select --version)")"  
    msg_info "Current path: $(style_wrap GREEN "$(xcode-select --print-path)")"
    return 0
  fi
  
  # Install Command Line Tools
  msg_info "Installing Xcode Command Line Tools..."
  show_spinner "Installing $(style_wrap GREEN "Command Line Tools")" "xcode-select --install" 180
  
  # Wait for installation to complete and verify
  local attempts=0
  while ! xcode-select -p &> /dev/null && [[ ${attempts} -lt 30 ]]; do
    sleep 2
    ((attempts++))
  done
  
  if xcode-select -p &> /dev/null; then
    msg_success "Command Line Tools installed successfully."
    msg_info "Version: $(style_wrap GREEN "$(xcode-select --version)")"
    msg_info "Path: $(style_wrap GREEN "$(xcode-select --print-path)")"
  else
    msg_error "Failed to install Command Line Tools."
    return 1
  fi
}

# Updates Xcode to the latest version available on the Mac App Store.
# Verifies Xcode installation before attempting updates and provides progress feedback.
# Shows comprehensive Xcode information after successful update completion.
# Integrates with mas-cli for App Store authentication and update workflows.
# @returns {number} 0 on success, 1 on error
update_xcode() {
  msg_header --underline --upper "\nUpdating Xcode:"
  echo
  
  # Check if Xcode is installed
  local xcode_info
  xcode_info=$(mas list | grep "^${XCODE_APP_ID} " || true)
  
  if [[ -z "${xcode_info}" ]]; then
    msg_warning "Xcode is not installed. Use \`install-xcode\` to install it first."
    return 1
  fi
  
  # Upgrade Xcode
  show_spinner "Updating $(style_wrap GREEN "Xcode")" "mas upgrade ${XCODE_APP_ID}"
  
  # Show current info
  echo
  msg_info "Current info: \n\n$(style_wrap GREEN "$(mas info "${XCODE_APP_ID}")")"
}

# Installs Xcode from the Mac App Store if not already present.
# Checks for existing installation before attempting installation to avoid unnecessary downloads.
# Provides clear progress feedback and warns about large download size and time requirements.
# Shows comprehensive Xcode information after successful installation completion.
install_xcode() {
  msg_header --underline --upper "\nInstalling Xcode:"
  echo
  
  # Check if Xcode is already installed
  local xcode_info
  xcode_info=$(mas list | grep "^${XCODE_APP_ID} " || true)
  
  if [[ -n "${xcode_info}" ]]; then
    msg_success "Xcode is already installed."
    echo
    msg_info "Current $(style_wrap GREEN "Xcode") info:\n\n$(style_wrap GREEN "$(mas info "${XCODE_APP_ID}")")"
    return 0
  fi
  
  # Install Xcode
  msg_warning --italic "Note: Xcode is a large download (several GB) and may take a long time."§
  echo
  show_spinner -show-output "Installing $(style_wrap GREEN "Xcode")" "mas install ${XCODE_APP_ID}" 0
  
  # Show installation info
  echo
  msg_info "Current $(style_wrap GREEN "Xcode") info:\n\n$(style_wrap GREEN "$(mas info "${XCODE_APP_ID}")")"
}

# Lists App Store packages with status categorization and filtering options.
# Displays packages in groups: up-to-date, outdated, and not installed.
# Supports --outdated filtering to show only packages with available updates.
# Provides troubleshooting guidance when authentication or service issues occur.
# @param {boolean} show_outdated - Whether to show only outdated packages
list_appstore() {
  local show_outdated="$1"
  local -a appstore_apps
  appstore_apps=("${(@f)$(get_applist_packages "appstore_apps")}")
  
  # Check if there are any appstore apps defined
  if [[ ${#appstore_apps[@]} -eq 0 ]]; then
    msg_header --underline --upper "\nShowing App Store Apps" "(0):\n"
    msg_warning --color "  No App Store apps defined in applist.yaml"
    return 0
  fi
  
  msg_header --underline --upper "\nShowing App Store Apps" "(${#appstore_apps[@]}):\n"

  # Get all installed and outdated apps at once with spinner
  local installed_list outdated_list outdated_success
  local temp_installed
  local temp_outdated
  temp_outdated=$(mktemp)
  temp_installed=$(mktemp)

  # Fetch installed apps
  show_spinner "Getting installed App Store apps" "mas list > '${temp_installed}'"
  installed_list=$(cat "${temp_installed}")
  rm -f "${temp_installed}"

  # Fetch outdated apps
  show_spinner "Checking for outdated App Store apps" "mas outdated > '${temp_outdated}'" && outdated_success=true || outdated_success=false
  outdated_list=$(cat "${temp_outdated}")
  rm -f "${temp_outdated}"

  # Arrays to group packages by status
  local -a uptodate_packages=()
  local -a outdated_packages=()
  local -a not_installed_packages=()

  # Categorize packages
  for app in "${appstore_apps[@]}"; do
    local installed_info=""
    installed_info=$(grep -i " ${app} " <<< "${installed_list}" || true)

    if [[ -n "${installed_info}" ]]; then
      local current_version="" is_outdated="" latest_version=""
      current_version=$(awk -F'[()]' '{print $2}' <<< "${installed_info}")      
      is_outdated=$(grep -i " ${app} " <<< "${outdated_list}" || true)

      if [[ -n "${is_outdated}" ]]; then
        latest_version=$(awk -F'->' '{gsub(/[() ]/, "", $2); print $2}' <<< "${is_outdated}")
        # Outdated
        outdated_packages+=("${app} ${STYLE[YELLOW]}${current_version}${STYLE[RESET]} ${SYMBOL[ARROW]} ${STYLE[LIGHT_GREEN]}${latest_version}${STYLE[RESET]}")
      else
        # Up to date
        uptodate_packages+=("${app} ${STYLE[LIGHT_GREEN]}${current_version}${STYLE[RESET]}")
      fi
    else
      # Not installed
      not_installed_packages+=("${app}")
    fi
  done
  # Display packages grouped by status
  # Show up-to-date packages
  if [[ "${show_outdated}" != true ]]; then
    if [[ ${#uptodate_packages[@]} -gt 0 ]]; then
      echo
      msg_header h3 --upper "  Up-to-date" "(${#uptodate_packages[@]}):\n"
      for package in "${uptodate_packages[@]}"; do
        msg_success --bold "  ${package}"
      done
    fi
  fi
  # Show outdated packages
  if [[ ${#outdated_packages[@]} -gt 0 ]]; then
    echo
    msg_header h4 --upper "  Outdated" "(${#outdated_packages[@]}):\n"
    for package in "${outdated_packages[@]}"; do
      msg_warning "  ${package}"
    done
  elif [[ "${show_outdated}" == true ]]; then
    echo
    msg_success --italic --color "  All App Store apps are up-to-date!"
  fi
  # Show not installed packages
  if [[ "${show_outdated}" != true && ${#not_installed_packages[@]} -gt 0 ]]; then
    echo
    msg_header h5 --upper "  Not installed" "(${#not_installed_packages[@]}):\n"
    for package in "${not_installed_packages[@]}"; do
      msg_error --italic "  ${package}"
    done
  fi
  
  # Show troubleshooting message if outdated check failed
  if [[ "${outdated_success}" != true ]]; then
    echo
    msg_warning --color "  App Store outdated check failed. For more info run: $(style_wrap RESET BOLD "mas account") / $(style_wrap BOLD "mas outdated")"
  fi
}

# Lists npm packages with status categorization and filtering options.
# Displays packages in groups: up-to-date, outdated, and not installed.
# Supports --outdated filtering to show only packages with available updates.
# Provides troubleshooting guidance when outdated checks fail or authentication issues occur.
# @param {boolean} show_outdated - Whether to show only outdated packages
list_npm() {
  local show_outdated="$1"
  local -a npm_apps
  npm_apps=("${(@f)$(get_applist_packages "npm_apps")}")

  # Check if there are any npm packages defined
  if [[ ${#npm_apps[@]} -eq 0 ]]; then
    msg_header --underline --upper "\nShowing NPM Packages" "(0):\n"
    msg_warning --color "  No npm packages defined in applist.yaml"
    return 0
  fi
  
  msg_header --underline --upper "\nShowing NPM Packages" "(${#npm_apps[@]}):\n"

  # Get all npm packages info with spinners
  local installed_list outdated_list outdated_success
  local temp_installed
  local temp_outdated
  outdated_success=false
  temp_outdated=$(mktemp)
  temp_installed=$(mktemp)

  # Fetch installed packages
  show_spinner "Getting installed npm packages" "npm list -g > '${temp_installed}'"
  installed_list=$(cat "${temp_installed}")
  rm -f "${temp_installed}"

  # Fetch outdated packages
   show_spinner "Checking for outdated npm packages" "npm outdated -g > '${temp_outdated}'" && outdated_success=true
  outdated_list=$(cat "${temp_outdated}")
  rm -f "${temp_outdated}"

  # Arrays to group packages by status
  local -a uptodate_packages=()
  local -a outdated_packages=()
  local -a not_installed_packages=()

  # Categorize packages
  for app in "${npm_apps[@]}"; do
    local installed_info=""
    installed_info=$(echo "${installed_list}" | grep " ${app}@" || true)

    if [[ -n "${installed_info}" ]]; then
      local current_version="" is_outdated="" latest_version=""
      # More robust version extraction for scoped and regular packages
      current_version=$(echo "${installed_info}" | sed -n "s|.*${app}@\([^[:space:]]*\).*|\1|p" || true)
      is_outdated=$(echo "${outdated_list}" | grep "^${app} " || true)

      if [[ -n "${is_outdated}" ]]; then
        latest_version=$(echo "${is_outdated}" | awk '{print $4}' || true)
        # Outdated
        outdated_packages+=("${app} ${STYLE[RED]}${current_version}${STYLE[RESET]} ${SYMBOL[ARROW]} ${STYLE[YELLOW]}${latest_version}${STYLE[RESET]}")
      else
        # Up to date
        uptodate_packages+=("${app} ${STYLE[GREEN]}${current_version}${STYLE[RESET]}")
      fi
    else
      # Not installed
      not_installed_packages+=("${app}")
    fi
  done
  # Display packages grouped by status
  # Show up-to-date packages
  if [[ "${show_outdated}" != true ]]; then
    if [[ ${#uptodate_packages[@]} -gt 0 ]]; then
      echo
      msg_header h3 --upper "  Up-to-date" "(${#uptodate_packages[@]}):\n"
      for package in "${uptodate_packages[@]}"; do
        msg_success --bold "  ${package}"
      done
    fi
  fi
  # Show outdated packages
  if [[ ${#outdated_packages[@]} -gt 0 ]]; then
    echo
    msg_header h4 --upper "  Outdated" "(${#outdated_packages[@]}):\n"
    for package in "${outdated_packages[@]}"; do
      msg_warning --bold "  ${package}"
    done
  elif [[ "${show_outdated}" == true ]]; then
    echo
    msg_success "  All npm packages are up-to-date!"
  fi
  # Show not installed packages
  if [[ "${show_outdated}" != true && ${#not_installed_packages[@]} -gt 0 ]]; then
    echo
    msg_header h5 --upper "  Not installed" "(${#not_installed_packages[@]}):\n"
    for package in "${not_installed_packages[@]}"; do
      msg_error --italic "  ${package}"
    done
  fi
  
  # Show troubleshooting message if outdated check failed
  # Show troubleshooting message if outdated check failed
  if [[ "${outdated_success}" != true ]]; then
    echo
    msg_warning --color "  Npm outdated check failed. For more info run: $(style_wrap RESET BOLD "npm doctor") / $(style_wrap bold "npm outdated -g")"
  fi
}

# Lists Homebrew formulas and casks with status categorization and filtering options.
# Displays packages in groups: up-to-date, outdated, and not installed.
# Supports --outdated filtering to show only packages with available updates.
# Provides troubleshooting guidance when brew health checks fail or authentication issues occur.
# @param {string} package_type - Type of package ("formula" or "cask")
# @param {boolean} show_outdated - Whether to show only outdated packages
list_brew() {
  local package_type="$1" # "formula" or "cask"
  local show_outdated="$2"
  
  # Determine which app list to use and set appropriate variables
  local -a brew_apps
  if [[ "${package_type}" == "cask" ]]; then
    brew_apps=("${(@f)$(get_applist_packages "brew_casks")}")
  else
    brew_apps=("${(@f)$(get_applist_packages "brew_formulas")}")
  fi

  local app_key
  local display_name
  app_key="brew_${package_type}s"
  display_name="Brew ${package_type:c}s"

  # Check if there are any packages defined
  if [[ ${#brew_apps[@]} -eq 0 ]]; then
    msg_header --underline --upper "\nShowing ${display_name}" "(0):\n"
    msg_warning --color "  No ${display_name} defined in applist.yaml"
    return 0
  fi
  
  msg_header --underline --upper "\nShowing ${display_name}" "(${#brew_apps[@]}):\n"

  # Get outdated packages info with spinner
  local outdated_apps installed_apps outdated_success
  local temp_outdated
  local temp_installed
  temp_outdated=$(mktemp)
  temp_installed=$(mktemp)

  # Fetch outdated packages
  show_spinner "Checking for outdated ${package_type}s" "brew outdated --${package_type} > '${temp_outdated}'" && outdated_success=true || outdated_success=false
  outdated_apps=$(cat "${temp_outdated}")
  rm -f "${temp_outdated}"

  # Fetch installed packages
  if [[ "${package_type}" == "cask" ]]; then
    show_spinner "Getting installed ${package_type}" "brew list --cask --versions > '${temp_installed}'"
  else
    show_spinner "Getting installed ${package_type}" "brew list --versions > '${temp_installed}'"
  fi
  installed_apps=$(cat "${temp_installed}")
  rm -f "${temp_installed}"
  
  # Pre-fetch JSON data for all outdated packages that are in our list
  local brew_json=""
  if [[ -n "${outdated_apps}" ]]; then
    local -a outdated_in_list=()
    for app in "${brew_apps[@]}"; do
      if echo "${outdated_apps}" | grep -q "^${app}$"; then
        outdated_in_list+=("${app}")
      fi
    done
    
    # Fetch JSON for all outdated packages at once with spinner
    if [[ ${#outdated_in_list[@]} -gt 0 ]]; then
      local temp_json
      local brew_info_cmd
      temp_json=$(mktemp)
      brew_info_cmd="brew info --json=v2 --${package_type} $(printf '%s ' "${outdated_in_list[@]}") > '${temp_json}'"
      show_spinner "Fetching version info for ${#outdated_in_list[@]} outdated ${package_type}s" "${brew_info_cmd}" 15
      brew_json=$(cat "${temp_json}")
      rm -f "${temp_json}"
    fi
  fi

  # Arrays to group packages by status
  local -a uptodate_packages=()
  local -a outdated_packages=()
  local -a not_installed_packages=()

  # Categorize packages
  for app in "${brew_apps[@]}"; do
    # Extract current version (if installed)
    local app_info='' current_version=''
    app_info=$(echo "${installed_apps}" | grep "^${app} " || true)
    current_version=$(echo "${app_info}" | awk '{print $2}' || true)

    if [[ -n "${app_info}" ]]; then
      # Check if it's outdated
      local latest_version='' is_outdated=''
      is_outdated=$(echo "${outdated_apps}" | grep "^${app}$" || true)
      
      if [[ -n "${is_outdated}" && -n "${brew_json}" ]]; then
        # Extract latest version from pre-fetched JSON data
        if [[ "${package_type}" == "cask" ]]; then
          latest_version=$(echo "${brew_json}" | yq -r ".casks[] | select(.token == \"${app}\") | .version" 2>/dev/null || true)
        else
          latest_version=$(echo "${brew_json}" | yq -r ".formulae[] | select(.name == \"${app}\") | .versions.stable" 2>/dev/null || true)
        fi
      fi

      if [[ -n "${latest_version}" ]]; then
        # Outdated
        outdated_packages+=("${app} ${STYLE[YELLOW]}${current_version}${STYLE[RESET]} ${SYMBOL[ARROW]} ${STYLE[LIGHT_GREEN]}${latest_version}${STYLE[RESET]}")
      else
        # Up to date
        uptodate_packages+=("${app} ${STYLE[LIGHT_GREEN]}${current_version}${STYLE[RESET]}")
      fi
    else
      # Not installed
      not_installed_packages+=("${app}")
    fi
  done
  # Display packages grouped by status
  # Show up-to-date packages
  if [[ "${show_outdated}" != true ]]; then
    if [[ ${#uptodate_packages[@]} -gt 0 ]]; then
      echo
      msg_header h3 --upper "  Up-to-date" "(${#uptodate_packages[@]}):\n"
      for package in "${uptodate_packages[@]}"; do
        msg_success --bold "  ${package}"
      done
    fi
  fi
  # Show outdated packages
  if [[ ${#outdated_packages[@]} -gt 0 ]]; then
    echo
    msg_header h4 --upper "  Outdated ${package_type:c}s" "(${#outdated_packages[@]}):\n"
    for package in "${outdated_packages[@]}"; do
      msg_warning --bold "  ${package}"
    done
  elif [[ "${show_outdated}" == true ]]; then
    echo
    msg_success --color "  All ${display_name} are up-to-date!"
  fi

  # Show not installed packages
  if [[ "${show_outdated}" != true && ${#not_installed_packages[@]} -gt 0 ]]; then
    echo
    msg_header h5 --upper "  Not installed" "(${#not_installed_packages[@]}):\n"
    for package in "${not_installed_packages[@]}"; do
      msg_error --italic "  ${package}"
    done
  fi
  
  # Show troubleshooting message if outdated check failed
  if [[ "${outdated_success}" != true ]]; then
    echo
    msg_warning --color "  Brew outdated check failed. For more info run: $(style_wrap RESET BOLD "brew doctor") / $(style_wrap BOLD "brew outdated")"
  fi
}

# Lists Xcode with status information and update availability.
# Checks installation status and compares with available updates from the Mac App Store.
# Provides current version information and update availability status.
list_xcode() {
  msg_header --underline --upper "\nXcode:\n\n"
  
  local installed_info
  installed_info=$(mas list | grep "^${XCODE_APP_ID} " || true)
  if [[ -n "${installed_info}" ]]; then
    local current_version is_outdated
    current_version=$(echo "${installed_info}" | grep -o '([^)]*)' | sed 's/[()]//g')
    is_outdated=$(mas outdated | grep "^${XCODE_APP_ID} " || true)
    
    if [[ -n "${is_outdated}" ]]; then
      msg_warning "  Xcode ${STYLE[YELLOW]}${current_version}"
    else
      msg_success "  Xcode ${STYLE[CYAN]}${current_version}"
    fi
  else
    # Not installed
    msg_error --color "  Xcode is not installed."
  fi
}

# Lists Xcode Command Line Tools with status information and update availability.
# Checks installation status and compares with available system updates.
# Provides current version information and update availability status.
list_xcode_tools() {
  msg_header --upper "\nXcode Command Line Tools:\n\n"

  local is_installed=false
  local current_version=""
  xcode-select -p &>/dev/null && is_installed=true
  
  if [[ "${is_installed}" == true ]]; then
    current_version=$(pkgutil --pkg-info=com.apple.pkg.CLTools_Executables 2>/dev/null | grep version | awk '{print $2}' || true)
    local update_available
    update_available=$(softwareupdate list 2>/dev/null | grep -i "command line tools" || true)
    
    if [[ -n "${update_available}" ]]; then
      msg_warning "  Xcode Command Line Tools ${STYLE[CYAN]}${current_version}${STYLE[RESET]} → ${STYLE[GREEN]}update available${STYLE[RESET]}"
    else
      msg_success "  Xcode Command Line Tools ${STYLE[CYAN]}${current_version}${STYLE[RESET]}"
    fi
  else
    msg_error --color "  Xcode Command Line Tools is not installed."
  fi
}

# Performs comprehensive updates across all supported package managers and system components.
# Sequentially updates brew formulas, npm packages, Zsh configuration, Python packages, and macOS components.
# Includes Oh My Zsh, Zinit, pip, Xcode Command Line Tools, Homebrew casks, and App Store applications.
# Provides progress feedback for each component and handles macOS-specific operations appropriately.
update_all() {
  msg_header --upper --underline "\nPerforming All Updates:"

  update_formulas
  update_npm

  # ZSH
  show_spinner "Updating Oh My Zsh" "omz update"  # it returns false even when success, so no &&
  show_spinner "Updating Zinit" "zinit update"

  # PIP
  show_spinner "Updating PIP" "pip3 install --upgrade pip"

  # MACOS
  # -----
  # CLI Tools without full Xcode
  if [[ "${OSTYPE}" == "darwin"* ]]; then
    update_xcode_tools
    update_casks
    update_appstore
  fi
}

# Performs comprehensive installations across all supported package managers and system components.
# Sequentially installs brew formulas, npm packages, and macOS-specific components.
# Includes Xcode Command Line Tools, Homebrew casks, and App Store applications.
# Provides progress feedback for each component and handles macOS-specific operations appropriately.
install_all() {
  msg_header --upper --underline "\nPerforming All Installations:"

  install_formulas
  install_npm_apps

  # MACOS
  # -----
  if [[ "${OSTYPE}" == "darwin"* ]]; then
    install_xcode_tools
    install_casks
    install_appstore_apps
  fi
}
