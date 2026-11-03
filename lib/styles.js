// dsh-moss-image · 画风提示词目录。
// 每个画风就是一串固定的英文提示词，生成时拼在用户描述最前面。
// 内容来自 `画图风格提示词/` 下的 md 文件；要加画风就在这里加一条，id 会存进设置。
export const STYLES = [
    {
        id: "ink-wash",
        label: "粗墨飞白写意水墨国画风",
        prompt: "ink_wash_painting, zhongguo_hua, expressive anime illustration, sweeping charcoal-black brush contours with dry-brush flying-white breaks, concentrated azurite blue and cinnabar red mineral-color accents, pale unpainted paper separating dense ink masses, alternating wet pool",
    },
    {
        id: "backlit-cel",
        label: "逆光幻彩清透赛璐璐风",
        prompt: "anime illustration, anime_coloring, colored_lineart, delicate fine linework, crisp cel shading with subtle soft gradients, cool lavender and muted violet shadows, warm rosy skin tones, luminous near-white highlights, vivid accent colors, finely detailed hair and fabric folds, glossy multicolored anime eyes, strong directional backlighting, irregular patches of sunlight across the figure, translucent rainbow lens flare rings, small prismatic light glints, softly blurred foreground, richly layered composition",
    },
    {
        id: "contrast-cel",
        label: "高反差几彩线撞色赛璐璐风",
        prompt: "anime illustration, anime_coloring, saturated, high_contrast, colored_lineart, vivid primary-color palette with dominant cobalt blue, scarlet red and electric cyan accents, crisp angular cel shading, deep navy-black shadow masses, sharp tapered ink contours interwoven with fine multicolored accent lines, ribbon-like flowing hair strands with narrow saturated highlights, luminous jewel-like eyes with intricate multicolored reflections, pale peach skin with restrained warm shadows, clean bright facial planes contrasted against densely detailed surrounding shapes, bold graphic color blocking, energetic sweeping curves and overlapping diagonals",
    },
    {
        id: "hue-shift",
        label: "高反差色相偏移锐线图形风",
        prompt: "stylized anime illustration, anime_coloring, high_contrast, colored_lineart, complementary_colors, hue_shifting, expressive tapered contours combining sweeping curves and sharp pointed ends, crisp graphic cel-shadow shapes, broad uninterrupted color areas balanced by intricate focal details, deep chromatic shadows contrasted with brilliant white highlight slashes, vivid accent colors concentrated along selected edges, shadows shifting toward contrasting hues rather than neutral grey, ribbon-like hair shapes, sharply segmented glossy highlights, luminous layered irises with clearly defined dark pupils, bold overlapping silhouettes, energetic diagonal visual flow, selective fine colored edge accents",
    },
]

/** 按 id 找画风；空串或找不到都返回 undefined（= 不追加）。 */
export function styleById(id) {
    if (typeof id !== "string" || id === "") return undefined
    return STYLES.find((style) => style.id === id)
}

/**
 * 把画风拼到提示词最前面。没选画风时原样返回，一个字符都不动。
 * 用户选的画风不算「私自改提示词」：它来自设置，回显里也会写明。
 */
export function applyStyle(stylePrompt, prompt) {
    const text = typeof prompt === "string" ? prompt : ""
    if (typeof stylePrompt !== "string" || stylePrompt.trim() === "") return text
    const body = text.trim()
    return body === "" ? stylePrompt.trim() : `${stylePrompt.trim()}, ${body}`
}
