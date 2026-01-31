/// <reference types="vite/client" />

// emoji-picker-element 是 web component，为 JSX 声明内置元素
declare namespace JSX {
  interface IntrinsicElements {
    'emoji-picker': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
      ref?: React.Ref<HTMLElement>;
    };
  }
}
