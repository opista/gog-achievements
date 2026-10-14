// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { Art } from '../../src/renderer/components/Art';
afterEach(cleanup);
const hash = '5a51d9484a3985b1f6e37eddc1853cb6d84bece22e2a5d80dfdbf30d3b0e8444';
it('resolves protocol-relative GOG library hashes to the cover thumbnail', () => {
  const { container } = render(
    <Art name="Cyberpunk 2077" image={'//images-1.gog-statics.com/' + hash} />,
  );
  expect(container.querySelector('img')?.getAttribute('src')).toBe(
    'https://images-1.gog-statics.com/' + hash + '_196.jpg',
  );
});
it('preserves complete game and achievement image URLs', () => {
  const image = 'https://images.gog-statics.com/' + hash + '_392.jpg';
  const { container, rerender } = render(<Art name="Game" image={image} />);
  expect(container.querySelector('img')?.getAttribute('src')).toBe(image);
  rerender(
    <Art name="Achievement" kind="achievement" image={'https://images.gog-statics.com/' + hash} />,
  );
  expect(container.querySelector('img')?.getAttribute('src')).toBe(
    'https://images.gog-statics.com/' + hash,
  );
});
it.each([
  'http://images.gog-statics.com/' + hash,
  'https://attacker.example/' + hash,
  'https://user:pass@images.gog-statics.com/' + hash,
  'javascript:alert(1)',
])('uses the icon fallback for an unsafe artwork reference: %s', (image) => {
  const { container } = render(<Art name="Game" image={image} />);
  expect(container.querySelector('img')).toBeNull();
});
