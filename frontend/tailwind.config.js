/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,jsx}", "./public/index.html"],
  theme: {
    extend: {
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
