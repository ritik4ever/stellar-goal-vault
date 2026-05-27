import type { Preview } from '@storybook/react-vite';
import '../src/index.css';

const preview: Preview = {
  decorators: [
    (Story) => {
      document.documentElement.setAttribute('data-theme', 'dark');
      return <Story />;
    },
  ],
  parameters: {
    backgrounds: {
      default: 'dark',
      values: [
        { name: 'dark', value: '#0f172a' },
        { name: 'light', value: '#f8fafc' },
      ],
    },
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    a11y: {
      test: 'todo',
    },
  },
};

export default preview;