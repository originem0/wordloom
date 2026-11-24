import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  // .claude/worktrees holds whole checkouts of this repo (agent worktrees).
  globalIgnores(['dist', '.claude']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
  },
  {
    // shadcn/ui primitives are vendored as generated: each file exports its
    // component together with its cva() variants. Splitting them would fork
    // the files from upstream for a dev-only Fast Refresh nicety.
    files: ['src/client/components/ui/**/*.tsx'],
    rules: { 'react-refresh/only-export-components': 'off' },
  },
])
