import type { ThemeRegistrationRaw } from 'shiki/core'

/** The Matrix theme has no published syntax theme, so Gramatrix defines its own. */
export const MATRIX_CODE_THEME: ThemeRegistrationRaw = {
  name: 'matrix',
  type: 'dark',
  fg: '#d7e8d7',
  bg: '#0b0b0b',
  settings: [
    { settings: { foreground: '#d7e8d7', background: '#0b0b0b' } },
    { scope: ['comment', 'punctuation.definition.comment'], settings: { foreground: '#6f8f6f' } },
    {
      scope: ['string', 'string.quoted', 'markup.inline.raw'],
      settings: { foreground: '#7dff9b' }
    },
    { scope: ['constant.numeric', 'constant.language'], settings: { foreground: '#c8ff6b' } },
    {
      scope: ['keyword', 'storage', 'keyword.control', 'keyword.operator.new'],
      settings: { foreground: '#00e63a' }
    },
    {
      scope: ['entity.name.function', 'support.function', 'meta.function-call'],
      settings: { foreground: '#b8ffd0' }
    },
    {
      scope: ['entity.name.type', 'entity.name.class', 'support.type', 'support.class'],
      settings: { foreground: '#5fe0c0' }
    },
    { scope: ['variable.parameter'], settings: { foreground: '#c3e6c3' } },
    { scope: ['entity.name.tag'], settings: { foreground: '#00e63a' } },
    { scope: ['entity.other.attribute-name'], settings: { foreground: '#b8ffd0' } },
    { scope: ['punctuation'], settings: { foreground: '#9ab89a' } },
    { scope: ['markup.heading'], settings: { foreground: '#00e63a', fontStyle: 'bold' } },
    { scope: ['markup.inserted'], settings: { foreground: '#7dff9b' } },
    { scope: ['markup.deleted'], settings: { foreground: '#ff8a7e' } }
  ]
}
