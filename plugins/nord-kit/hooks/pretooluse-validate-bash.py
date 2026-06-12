#!/usr/bin/env python3
"""
Bash Command Validator Hook
Analyzes bash commands for potentially harmful operations before execution.
"""

import sys
import json
import re
import os
from typing import Dict, List, Tuple, Optional

class BashCommandValidator:
    def __init__(self):
        # Critical system paths that should never be deleted
        self.protected_paths = {
            '/', '/bin', '/boot', '/dev', '/etc', '/lib', '/lib64',
            '/proc', '/root', '/sbin', '/sys', '/usr', '/var',
            '/usr/bin', '/usr/lib', '/usr/sbin', '/etc/passwd',
            '/etc/shadow', '/etc/group', '/boot/grub'
        }
        
        # Patterns for dangerous operations
        self.dangerous_patterns = [
            # Recursive force delete on root or critical paths
            (r'rm\s+-[rf]{2}\s+(/\s|/\*|--no-preserve-root)', 'recursive deletion of root filesystem'),
            (r'rm\s+-rf\s+~/?(\s|$)', 'recursive deletion of home directory'),
            (r'rm\s+-rf\s+\$HOME', 'recursive deletion of home directory'),
            
            # Dangerous find operations
            (r'find\s+/\s+.*-delete', 'find with delete starting from root'),
            (r'find\s+.*-exec\s+rm\s+-rf', 'find with recursive force delete'),
            (r'find\s+/.*-execdir\s+rm', 'find execdir with rm starting from root'),
            
            # Pipe to xargs rm
            (r'\|\s*xargs\s+rm\s+-rf', 'piping to xargs with recursive force delete'),
            
            # Disk operations
            (r'dd\s+.*of=/dev/(sd|hd|nvme)', 'writing directly to disk device'),
            (r'mkfs\.\w+\s+/dev/', 'formatting disk partition'),
            
            # System control
            (r':()\{\s*:\|\:&\s*\};:', 'fork bomb'),
            (r'>\s*/dev/sd[a-z]', 'redirecting output to raw disk'),
            (r'chmod\s+-R\s+000', 'recursive permission removal'),
            
            # Dangerous redirects
            (r'>\s*/etc/(passwd|shadow|group|sudoers)', 'overwriting critical system files'),
        ]
        
        # Commands that need scrutiny but aren't always bad
        self.scrutinize_commands = [
            'rm', 'dd', 'mkfs', 'fdisk', 'parted', 'shred',
            'chmod', 'chown', 'systemctl', 'service'
        ]

    def extract_command(self, input_data: Dict) -> Optional[str]:
        """Extract the bash command from the input JSON."""
        try:
            # Handle different possible input formats
            if 'tool_input' in input_data:
                tool_input = input_data['tool_input']
                if isinstance(tool_input, str):
                    tool_input = json.loads(tool_input)
                if isinstance(tool_input, dict):
                    return tool_input.get('command', '')
                return str(tool_input)
            
            # Direct command in input
            if 'command' in input_data:
                return input_data['command']
            
            # Check in parameters
            if 'parameters' in input_data:
                params = input_data['parameters']
                if isinstance(params, str):
                    params = json.loads(params)
                if isinstance(params, dict):
                    return params.get('command', '')
            
            return None
        except (json.JSONDecodeError, KeyError, TypeError) as e:
            print(f"Debug: Error extracting command: {e}", file=sys.stderr)
            return None

    def check_dangerous_patterns(self, command: str) -> Tuple[bool, str]:
        """Check if command matches known dangerous patterns."""
        for pattern, description in self.dangerous_patterns:
            if re.search(pattern, command, re.IGNORECASE):
                return True, description
        return False, ''

    def check_protected_paths(self, command: str) -> Tuple[bool, List[str]]:
        """Check if command targets protected system paths."""
        found_paths = []
        
        # Check for rm operations on protected paths
        if 'rm' in command:
            for path in self.protected_paths:
                # Match the path with word boundaries
                if re.search(rf'\brm\s+.*{re.escape(path)}(/|\s|$)', command):
                    found_paths.append(path)
        
        return len(found_paths) > 0, found_paths

    def check_variable_expansion_risk(self, command: str) -> Tuple[bool, str]:
        """Check for risky variable expansions that could target critical paths."""
        risky_patterns = [
            (r'rm\s+-rf\s+\$\{.*\}', 'rm with potentially unset variable'),
            (r'rm\s+-rf\s+\$[A-Z_]+/?$', 'rm with environment variable that could be unset'),
            (r'rm\s+-rf\s+\*', 'rm with unquoted wildcard in current directory'),
        ]
        
        for pattern, description in risky_patterns:
            if re.search(pattern, command):
                return True, description
        
        return False, ''

    def analyze_rm_command(self, command: str) -> Tuple[str, str]:
        """Detailed analysis of rm commands."""
        # Check if it's a recursive force delete
        if re.search(r'rm\s+-[rf]{2}', command):
            # Extract what's being deleted
            match = re.search(r'rm\s+-[rf]{2}\s+(.+?)(\s|$|;|\||&)', command)
            if match:
                target = match.group(1).strip()
                
                # Dangerous targets
                if target in ['/', '/*', '.', '..', '~', '$HOME']:
                    return 'DENY', f'recursive force delete of critical location: {target}'
                
                # Check if it's in a protected path
                for protected in self.protected_paths:
                    if target.startswith(protected):
                        return 'DENY', f'attempting to delete protected system path: {target}'
                
                # Wildcards at root level
                if target.startswith('/*'):
                    return 'DENY', 'wildcard deletion at root level'
                
                # Otherwise might be OK, but ask for confirmation
                return 'ASK', f'recursive force delete of: {target}'
        
        return 'ALLOW', ''

    def validate(self, command: str) -> Dict[str, any]:
        """Main validation logic."""
        if not command or command.strip() == '':
            return {'action': 'ALLOW', 'reason': 'empty command'}
        
        # Check for dangerous patterns first
        is_dangerous, description = self.check_dangerous_patterns(command)
        if is_dangerous:
            return {
                'action': 'DENY',
                'reason': f'Dangerous pattern detected: {description}',
                'command': command
            }
        
        # Check protected paths
        targets_protected, paths = self.check_protected_paths(command)
        if targets_protected:
            return {
                'action': 'DENY',
                'reason': f'Command targets protected system paths: {", ".join(paths)}',
                'command': command
            }
        
        # Check variable expansion risks
        has_var_risk, var_description = self.check_variable_expansion_risk(command)
        if has_var_risk:
            return {
                'action': 'ASK',
                'reason': f'Potentially dangerous variable expansion: {var_description}',
                'command': command
            }
        
        # Detailed rm analysis
        if 'rm' in command:
            action, reason = self.analyze_rm_command(command)
            if action != 'ALLOW':
                return {'action': action, 'reason': reason, 'command': command}
        
        # Check if command contains scrutinize-worthy operations
        for cmd in self.scrutinize_commands:
            if re.search(rf'\b{cmd}\b', command):
                # If we got here, it passed the dangerous checks
                # But these commands still warrant attention
                if cmd in ['dd', 'mkfs', 'fdisk', 'parted']:
                    return {
                        'action': 'ASK',
                        'reason': f'Disk operation command detected: {cmd}',
                        'command': command
                    }
        
        # Command appears safe
        return {'action': 'ALLOW', 'reason': 'command passed safety checks'}


def main():
    try:
        # Enable debug mode if environment variable is set
        debug = os.environ.get('CLAUDE_HOOK_DEBUG', '').lower() in ('1', 'true', 'yes')
        
        # Read input from stdin
        input_text = sys.stdin.read()
        
        if debug:
            print(f"Debug: Received input: {input_text}", file=sys.stderr)
        
        # Parse JSON input
        try:
            input_data = json.loads(input_text)
        except json.JSONDecodeError as e:
            if debug:
                print(f"Debug: JSON decode error: {e}", file=sys.stderr)
            # If we can't parse input, allow by default but log the issue
            result = {
                'action': 'ALLOW',
                'reason': 'Could not parse input JSON'
            }
            print(json.dumps(result), flush=True)
            sys.exit(0)
        
        # Extract command
        validator = BashCommandValidator()
        command = validator.extract_command(input_data)
        
        if debug:
            print(f"Debug: Extracted command: {command}", file=sys.stderr)
        
        if not command:
            # No command found, allow by default
            result = {'action': 'ALLOW', 'reason': 'no command found in input'}
        else:
            # Validate the command
            result = validator.validate(command)
        
        if debug:
            print(f"Debug: Validation result: {result}", file=sys.stderr)
        
        # Output result as JSON to stdout
        print(json.dumps(result), flush=True)
        
        # Exit code based on action
        if result['action'] == 'DENY':
            sys.exit(1)
        elif result['action'] == 'ASK':
            sys.exit(2)
        else:  # ALLOW
            sys.exit(0)
            
    except Exception as e:
        # On error, deny by default for safety
        if os.environ.get('CLAUDE_HOOK_DEBUG', '').lower() in ('1', 'true', 'yes'):
            print(f"Debug: Unexpected error: {e}", file=sys.stderr)
            import traceback
            traceback.print_exc(file=sys.stderr)
        
        error_result = {
            'action': 'DENY',
            'reason': f'Validation error: {str(e)}'
        }
        print(json.dumps(error_result), flush=True)
        sys.exit(1)


if __name__ == '__main__':
    main()
