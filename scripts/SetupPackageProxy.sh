#!/bin/bash
#
# JAMF Package Proxy Configuration Script
# 
# Configures npm, pip, uv, and cargo to use your package proxy
#
# This script is idempotent - safe to run multiple times.

set -euo pipefail

PACKAGE_PROXY_HOST="__REPLACE_ME__"
PACKAGE_PROXY_URL="https://$PACKAGE_PROXY_HOST"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
}

# Get the current console user (for JAMF context where script runs as root)
if [[ $EUID -eq 0 ]]; then
    CURRENT_USER=$(stat -f "%Su" /dev/console)
    USER_HOME=$(dscl . -read /Users/"$CURRENT_USER" NFSHomeDirectory | awk '{print $2}')
else
    CURRENT_USER="$USER"
    USER_HOME="$HOME"
fi

log "Configuring package registries for user: $CURRENT_USER"

run_as_user() {
    if [[ $EUID -eq 0 ]]; then
        sudo -iu "$CURRENT_USER" "$@"
    else
        "$@"
    fi
}

# =============================================================================
# NPM Configuration
# =============================================================================
configure_npm() {
    log "Checking npm configuration..."
    if ! run_as_user command -v npm &>/dev/null; then
        log "npm not found, skipping npm configuration"
        return 0
    fi
    
    local current_registry
    current_registry=$(run_as_user npm config get registry 2>/dev/null || echo "")
    if [[ "$current_registry" == "$PACKAGE_PROXY_URL" ]]; then
        log "npm registry already configured, skipping"
    else
        log "Setting npm registry..."
        run_as_user npm config set registry "$PACKAGE_PROXY_URL"
        run_as_user npm config set //$PACKAGE_PROXY_HOST/:_auth "$(echo -n "$CURRENT_USER:" | base64)"
        log "npm registry configured"
    fi
}

# =============================================================================
# pip Configuration
# =============================================================================
configure_pip() {
    log "Checking pip configuration..."
  	if ! xcode-select -p &>/dev/null; then
		log "Xcode Command Line Tools not found, skipping pip configuration"
		return 0
	fi

    if ! run_as_user command -v python3 &>/dev/null; then
        log "python3 not found, skipping pip configuration"
        return 0
    fi
    
    local current_index
    current_index=$(run_as_user python3 -m pip config get global.index-url 2>/dev/null || echo "")
    
    if [[ "$current_index" == *"$PACKAGE_PROXY_HOST"* ]]; then
        log "pip index-url already configured, skipping"
    else
        log "Setting pip index-url..."
        run_as_user python3 -m pip config set global.index-url "https://$CURRENT_USER@$PACKAGE_PROXY_HOST/pypi/"
        log "pip index-url configured"
    fi
}

# =============================================================================
# uv Configuration
# =============================================================================
configure_uv() {
    log "Checking uv configuration..."
    
    local uv_config_dir="$USER_HOME/.config/uv"
    local uv_config_file="$uv_config_dir/uv.toml"
    
    # Check if uv config already contains the proxy
    if [[ -f "$uv_config_file" ]] && grep -q "$PACKAGE_PROXY_HOST" "$uv_config_file" 2>/dev/null; then
        log "uv already configured, skipping"
        return 0
    fi
    
    log "Setting uv index-url..."
    
    # Create config directory if it doesn't exist
    if [[ ! -d "$uv_config_dir" ]]; then
        run_as_user mkdir -p "$uv_config_dir"
    fi
    
    # Append configuration
    echo "index-url = \"https://$CURRENT_USER@$PACKAGE_PROXY_HOST/pypi/\"" >> "$uv_config_file"
    run_as_user chown "$CURRENT_USER" "$uv_config_file" 2>/dev/null || true
    
    log "uv configured"
}

# =============================================================================
# Cargo Configuration
# =============================================================================
configure_cargo() {
    log "Checking cargo configuration..."
    
    local cargo_dir="$USER_HOME/.cargo"
    local cargo_config_file="$cargo_dir/config.toml"
    
    # Check if cargo config already contains the proxy
    if [[ -f "$cargo_config_file" ]] && grep -q "$PACKAGE_PROXY_HOST" "$cargo_config_file" 2>/dev/null; then
        log "cargo already configured, skipping"
        return 0
    fi
    
    log "Setting cargo registry..."
    
    # Create .cargo directory if it doesn't exist
    if [[ ! -d "$cargo_dir" ]]; then
        run_as_user mkdir -p "$cargo_dir"
    fi
    
    # Append configuration
    cat >> "$cargo_config_file" << EOF

[registries]
package-proxy = { index = "sparse+https://$CURRENT_USER@$PACKAGE_PROXY_HOST/cargo-rs/" }

[source.crates-io]
replace-with = "package-proxy"
EOF
    
    run_as_user chown "$CURRENT_USER" "$cargo_config_file" 2>/dev/null || true
    
    log "cargo configured"
}

# =============================================================================
# Main
# =============================================================================
main() {
    log "Starting package proxy configuration..."
    
    configure_npm
    configure_pip
    configure_uv
    configure_cargo
    
    log "Package proxy configuration complete"
}

main "$@"