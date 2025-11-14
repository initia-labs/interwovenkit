/** @type {import('stylelint').Config} */
export default {
  plugins: ["stylelint-order"],
  rules: {
    "order/order": ["custom-properties", "declarations"],
    "order/properties-order": [
      [
        {
          groupName: "position",
          emptyLineBefore: "always",
          noEmptyLineBetween: true,
          properties: ["position", "inset", "top", "bottom", "left", "right", "z-index"],
        },
        {
          groupName: "display",
          emptyLineBefore: "always",
          noEmptyLineBetween: true,
          properties: ["grid-area", "flex", "flex-shrink"],
        },
        {
          groupName: "display",
          emptyLineBefore: "always",
          noEmptyLineBetween: true,
          properties: [
            "display",
            "flex-direction",
            "flex-wrap",
            "grid-template-columns",
            "grid-template-rows",
            "grid-template-areas",
            "justify-content",
            "align-items",
            "gap",
          ],
        },
        {
          groupName: "size",
          emptyLineBefore: "always",
          noEmptyLineBetween: true,
          properties: ["width", "height"],
        },
      ],
      {
        unspecified: "bottomAlphabetical",
        emptyLineBeforeUnspecified: "always",
      },
    ],
  },
}
