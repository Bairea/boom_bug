import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  // src/**/*.js 是 tsc 的编译产物，不检查
  { ignores: ['node_modules/', 'src/**/*.js', '.shots/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      // 空 catch 是本项目惯例：localStorage 不可用时静默降级（注释在各自调用处）
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
);
