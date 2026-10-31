import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['out/', 'dist/', 'node_modules/', 'website/'] },
  ...tseslint.configs.recommended
)
