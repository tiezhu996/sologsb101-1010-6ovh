import { vitePreprocess } from '@sveltejs/vite-plugin-svelte'

/**
 * Svelte 5 配置：TypeScript 预处理 + 按组件自动识别 runes。
 *
 * 刻意不写死 `compilerOptions.runes: true`：
 * - 本项目全部组件使用 $state / $props / $derived / $effect，Svelte 5 会自动按 runes 模式编译；
 * - 若将来引入仍使用旧语法（$$props 等）的依赖组件，自动识别可避免编译期
 *   `legacy_props_invalid` 之类的中断，无需为了第三方库放宽整个项目的严格度。
 */
export default {
  preprocess: vitePreprocess()
}
