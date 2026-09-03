# Reorganization plan and report templates

Read when writing the plan for approval, or the completion report.

## Proposed reorganization plan

### Root Directory Cleanup
**Files to keep in root:**
- README.md
- docker-compose.yml
- pyproject.toml
[etc.]

**Files to move:**
1. [current_path] → [new_path]
   - Reason: [justification]
   - Dependencies to update: [list]

### Documentation Organization (.dev-docs/)
**Files to move:**
1. [current_path] → .dev-docs/[appropriate_subfolder]/[new_name]
   - Reason: [justification]

**Files to consolidate:**
1. Merge [file1], [file2], [file3] → .dev-docs/[folder]/[consolidated_name]
   - Content overlap: [description]
   - Preservation strategy: [how content will be combined]

### Scripts Organization (scripts/)
**Files to move:**
1. [current_path] → scripts/[new_name]
   - Dependencies to update: [list]

### Test Organization (tests/)
**Files to move/reorganize:**
1. [current_path] → tests/[proper_subfolder]/[new_name]

### Naming Convention Updates
**Files to rename:**
1. [old_name] → [new_name]
   - Follows convention: [explain pattern]
   - References to update: [list]

### Files for Deletion (REQUIRES CONFIRMATION)
1. [file_path]
   - Reason for deletion: [clear justification]
   - Last modified: [date]
   - Appears to be: [obsolete/redundant/generated]

### Dependency Updates Required
1. [file_path]: Update line [X] from [old] to [new]
2. [file_path]: Update import from [old] to [new]

### Risk Assessment
- **High Risk Operations**: [list operations that could break things]
- **Medium Risk Operations**: [list operations with some risk]
- **Low Risk Operations**: [list safe operations]

**Estimated total files affected**: [number]
```

**Wait for explicit user approval before proceeding.**

### Phase 3: Execution

Once approved, execute changes systematically:

1. **Start with low-risk operations** (documentation moves with no dependencies)
2. **Handle file moves/renames**:
   - Use Bash tool with appropriate commands
   - Verify destination directories exist (create if needed)
   - Confirm each operation succeeded
3. **Update all dependencies immediately** after each move
4. **Consolidate files** when merging documentation
5. **Apply naming conventions** consistently
6. **Clean up empty directories**

**After each significant operation:**
- Verify the change succeeded
- Update your change log
- Check for immediate breakage

### Phase 4: Validation

**1. Verify file operations**:
- Confirm all moves/renames completed successfully
- Check that no files were lost
- Validate new file locations

**2. Validate dependencies**:
- Search for broken import paths
- Check configuration files for broken references
- Test script execution paths

**3. Run validation commands** (if available):
```bash
# Example validation commands
python -m py_compile app/**/*.py  # Check Python syntax
docker-compose config  # Validate docker-compose
# Any project-specific validation
```

**4. Generate verification report**

### Phase 5: Reporting

Provide a comprehensive summary:

```markdown

## Completion report

### Summary of Changes
- **Files moved**: [count]
- **Files renamed**: [count]
- **Files consolidated**: [count]
- **Files deleted**: [count]
- **Dependencies updated**: [count]

### Root Directory Status
**Before**: [count] files
**After**: [count] files
**Files remaining**: [list essential files]

### Documentation Organization
**Structure**:
.dev-docs/
├── 01_plans/ ([count] files)
├── 02_tickets/ ([count] files)
├── 03_test_results/ ([count] files)
[etc.]

### Scripts Organization
**Location**: scripts/
**Files organized**: [count]
**Scripts available**: [list script names]

### Test Organization
**Structure**: tests/[subfolders]
**Files organized**: [count]

### Naming Convention Applied
**Pattern**: [describe naming convention]
**Examples**: [show before/after examples]

### Files Consolidated
1. [new_file] ← merged from [source1], [source2], [source3]
   - Content preserved: [description]

### Files Deleted
1. [file_path] - [reason]

### Validation Results
✓ All file operations successful
✓ No broken dependencies detected
✓ All imports resolve correctly
✓ Configuration files valid
[Any validation command outputs]

### Recommendations
- [Any follow-up suggestions]
- [Best practices to maintain organization]
```

---

## Organizational principles

### Root Directory Guidelines

**Keep in root:**
- README.md (main project documentation entry point)
- LICENSE (if present)
- .gitignore, .env, .env.example
- docker-compose.yml, docker-compose.prod.yml
- Package manager files: pyproject.toml, package.json, requirements.txt, Cargo.toml
- Build configuration: Makefile, setup.py
- CI/CD configuration: .github/, .gitlab-ci.yml
- Essential startup scripts: start.sh, stop.sh (if widely used)

**Move to .dev-docs/:**
- All markdown documentation except README.md
- Planning documents, architecture docs
- Implementation summaries and status reports
- Test results and analysis
- Meeting notes, decision logs

**Move to scripts/:**
- Utility scripts: fix_env.sh, validate_*.py
- Development helpers
- Database migration helpers
- Build and deployment scripts (unless root-level is standard for the project)

**Move to tests/:**
- All test files not currently in tests/
- Test configurations specific to testing
- Test data and fixtures

### .dev-docs Structure Conventions

Follow the existing structure:
```
.dev-docs/
├── 01_plans/           # High-level planning documents
├── 02_tickets/         # Task tickets organized by phase
├── 03_test_results/    # Test outputs and results
├── 04_meeting_notes/   # Meeting logs (if present)
├── 05_documentation_external_libs/  # External library docs
├── 06_analysis/        # Code analysis and reports
└── [other numbered folders following the pattern]
```

**Naming conventions within .dev-docs:**
- Use UPPERCASE for major documents: `PLAN1.md`, `COMPLETION_STATUS.md`
- Use descriptive prefixes: `TASK_1.1_`, `PHASE_2_`, `IMPLEMENTATION_SUMMARY`
- Be specific: Not "notes.md" but "ARCHITECTURE_DECISIONS.md"
- Group related files: All Phase 1 tickets in `02_tickets/phase_1_foundation/`

### Scripts Folder Conventions

```
scripts/
├── dev/              # Development utilities
├── db/               # Database operations
├── deploy/           # Deployment helpers
├── test/             # Test runners and validators
└── utils/            # General utilities
```

**Naming conventions:**
- Use lowercase with underscores: `fix_env.sh`, `validate_setup.py`
- Prefix by function: `db_migrate.sh`, `test_integration.py`, `deploy_prod.sh`
- Make purpose obvious from name

### Test Organization Conventions

Follow existing test structure:
```
tests/
├── unit/             # Unit tests mirroring app structure
├── integration/      # Integration tests
├── helpers/          # Test helpers and utilities
├── utils/            # Test utilities
├── tools/            # Tool-specific tests
├── sandbox/          # Sandbox tests
└── conftest.py       # Pytest configuration
```

### File Naming Conventions

**Apply consistent patterns:**

1. **Status/Summary documents**: `[SCOPE]_[TYPE].md`
   - Examples: `PHASE_1_COMPLETION_STATUS.md`, `TASK_3.1_IMPLEMENTATION_SUMMARY.md`

2. **Task tickets**: `TASK_[NUMBER]_[Descriptive_Name].md`
   - Examples: `TASK_1.1_Initialize_Project_Structure.md`

3. **Plans**: `PLAN[NUMBER].md` or `PLANNING_[Topic].md`
   - Examples: `PLAN1.md`, `PLANNING_Phase3+4.md`

4. **Scripts**: `[action]_[target].extension`
   - Examples: `fix_env.sh`, `validate_setup.py`, `deploy_backend.sh`

5. **Tests**: `test_[feature].py`
   - Examples: `test_websocket.py`, `test_conversation_fix.py`

---
