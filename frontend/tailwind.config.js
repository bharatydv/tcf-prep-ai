/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,jsx}", "./public/index.html"],
  theme: {
    extend: {
      screens: {
        // The header's own breakpoint. Its three parts measure 1019px wide
        // with the real fonts loaded, which does not fit the 992px content box
        // at lg (1024px) - the page scrolled sideways by 3px there, and by
        // 35px once the web fonts actually loaded. It first fits at ~1075px.
        hdr: "1100px",
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        heading: ["Poppins", "Inter", "sans-serif"],
      },
      colors: {
        primary: {
          DEFAULT: "#7C3AED",
          light: "#8B5CF6",
          lighter: "#A78BFA",
          dark: "#5B21B6",
        },
        ink: "#120822",
      },
      boxShadow: {
        soft: "0 4px 24px -6px rgba(124, 58, 237, 0.12)",
        lift: "0 12px 32px -8px rgba(124, 58, 237, 0.22)",
        card: "0 2px 16px -4px rgba(15, 23, 42, 0.08)",
      },
    },
  },
  plugins: [],
};
