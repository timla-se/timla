import js from '@eslint/js'
import reactHooksPlugin from 'eslint-plugin-react-hooks'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config([
  { ignores: ['**/dist/**', '**/node_modules/**'] },

  {
    files: ['frontend/**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    plugins: {
      'react-hooks': reactHooksPlugin,
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      eqeqeq: ['error', 'always'],
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      }],
      '@typescript-eslint/consistent-type-imports': ['error', {
        prefer: 'type-imports',
        fixStyle: 'separate-type-imports',
      }],
      // Design-system guardrail (issue #32): colors and sizes come from the
      // tokens in frontend/src/index.css @theme, not from raw values pasted
      // out of mockups. Pragmatic, not bulletproof — it stops the default
      // failure mode. Genuine one-offs: eslint-disable-next-line + reason.
      'no-restricted-syntax': [
        'error',
        {
          // Raw hex colors in any string/template — use a token
          // (text-warm-gray, var(--color-ok-soft), …) or add one in @theme.
          selector: 'Literal[value=/#[0-9a-fA-F]{3,8}/], TemplateElement[value.raw=/#[0-9a-fA-F]{3,8}/]',
          message: 'Raw hex color — use a design-system token (frontend/src/index.css @theme) instead.',
        },
        {
          // Numeric arbitrary Tailwind values (text-[13px], w-[400px], …) in
          // className strings — snap to the scale (text-13, w-100, p-3.5, …).
          // Non-numeric brackets (grid-cols-[…], max-w-[34ch], shadow-[…],
          // var() refs) are intentionally not matched.
          selector: 'JSXAttribute[name.name="className"] Literal[value=/-\\[\\d+(?:\\.\\d+)?(?:px|rem)?\\]/], JSXAttribute[name.name="className"] TemplateElement[value.raw=/-\\[\\d+(?:\\.\\d+)?(?:px|rem)?\\]/]',
          message: 'Arbitrary numeric Tailwind value — snap to the type/radius/spacing scale (see index.css @theme, issue #32).',
        },
      ],
    },
  },
])
