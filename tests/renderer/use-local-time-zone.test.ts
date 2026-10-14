// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { detectTimeZone } from '../../src/renderer/date-time';
import { useLocalTimeZone } from '../../src/renderer/use-local-time-zone';

vi.mock('../../src/renderer/date-time', () => ({ detectTimeZone: vi.fn() }));
const detect = vi.mocked(detectTimeZone);
beforeEach(() => {
  detect.mockReset().mockReturnValue('Europe/London');
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it('initializes from the machine time zone', () => {
  const { result } = renderHook(useLocalTimeZone);
  expect(result.current).toBe('Europe/London');
  expect(detect).toHaveBeenCalledTimes(1);
});

it('refreshes when the window regains focus after the machine zone changes', () => {
  const { result } = renderHook(useLocalTimeZone);
  detect.mockReturnValue('America/New_York');
  act(() => window.dispatchEvent(new Event('focus')));
  expect(result.current).toBe('America/New_York');
});

it('refreshes on visible pages and ignores hidden visibility changes', () => {
  const visible = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  const { result } = renderHook(useLocalTimeZone);
  detect.mockReturnValue('Asia/Tokyo');
  act(() => document.dispatchEvent(new Event('visibilitychange')));
  expect(result.current).toBe('Europe/London');
  expect(detect).toHaveBeenCalledTimes(1);
  visible.mockReturnValue('visible');
  act(() => document.dispatchEvent(new Event('visibilitychange')));
  expect(result.current).toBe('Asia/Tokyo');
  expect(detect).toHaveBeenCalledTimes(2);
});

it('does not rerender for an unchanged detected zone', () => {
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  const render = vi.fn();
  const { result } = renderHook(() => {
    render();
    return useLocalTimeZone();
  });
  act(() => {
    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));
  });
  expect(result.current).toBe('Europe/London');
  expect(detect).toHaveBeenCalledTimes(3);
  expect(render).toHaveBeenCalledTimes(1);
});

it('removes the same listeners on unmount and stops detecting changes', () => {
  const addFocus = vi.spyOn(window, 'addEventListener');
  const addVisibility = vi.spyOn(document, 'addEventListener');
  const removeFocus = vi.spyOn(window, 'removeEventListener');
  const removeVisibility = vi.spyOn(document, 'removeEventListener');
  const { unmount } = renderHook(useLocalTimeZone);
  const focus = addFocus.mock.calls.find(([type]) => type === 'focus')?.[1];
  const visibility = addVisibility.mock.calls.find(([type]) => type === 'visibilitychange')?.[1];
  expect(focus).toBeTypeOf('function');
  expect(visibility).toBeTypeOf('function');
  unmount();
  expect(removeFocus).toHaveBeenCalledWith('focus', focus);
  expect(removeVisibility).toHaveBeenCalledWith('visibilitychange', visibility);
  detect.mockClear();
  act(() => {
    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));
  });
  expect(detect).not.toHaveBeenCalled();
});
