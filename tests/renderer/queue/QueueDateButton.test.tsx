// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import * as dateTime from '../../../src/renderer/date-time';
import { QueueDateButton } from '../../../src/renderer/features/queue/QueueDateButton';

afterEach(cleanup);

function buttonProps() {
  return {
    date: '2020-11-01T05:30:00Z',
    name: 'The World',
    zone: 'America/New_York',
    disabled: false,
    onClick: vi.fn(),
  };
}

it('reuses the date title when controls, names and callbacks change', () => {
  const timestamp = vi.spyOn(dateTime, 'formatTimestamp');
  const occurrence = vi.spyOn(dateTime, 'localTimeOccurrence');
  const props = buttonProps();
  const { rerender } = render(<QueueDateButton {...props} />);
  const title = screen.getByRole('button', { name: 'Edit date for The World' }).title;
  expect(title).toContain('First occurrence');
  expect(timestamp).toHaveBeenCalledTimes(1);
  expect(occurrence).toHaveBeenCalledTimes(1);

  rerender(<QueueDateButton {...props} disabled />);
  const disabled = screen.getByRole('button', { name: 'Edit date for The World' });
  expect(disabled).toBeDisabled();
  fireEvent.click(disabled);
  expect(props.onClick).not.toHaveBeenCalled();

  const onClick = vi.fn();
  rerender(<QueueDateButton {...props} name="A New Name" onClick={onClick} />);
  const renamed = screen.getByRole('button', { name: 'Edit date for A New Name' });
  expect(renamed).toHaveAttribute('title', title);
  fireEvent.click(renamed);
  expect(onClick).toHaveBeenCalledTimes(1);
  expect(props.onClick).not.toHaveBeenCalled();
  expect(timestamp).toHaveBeenCalledTimes(1);
  expect(occurrence).toHaveBeenCalledTimes(1);
});

it('updates the occurrence when the instant changes within the same repeated wall time', () => {
  const timestamp = vi.spyOn(dateTime, 'formatTimestamp');
  const occurrence = vi.spyOn(dateTime, 'localTimeOccurrence');
  const props = buttonProps();
  const { rerender } = render(<QueueDateButton {...props} />);
  const button = screen.getByRole('button', { name: 'Edit date for The World' });
  const firstTitle = button.title;
  expect(firstTitle).toContain('First occurrence');

  rerender(<QueueDateButton {...props} date="2020-11-01T06:30:00Z" />);
  expect(button.title).toContain('Second occurrence');
  expect(button.title.split(' · ')[0]).toBe(firstTitle.split(' · ')[0]);
  expect(timestamp).toHaveBeenCalledTimes(2);
  expect(occurrence).toHaveBeenCalledTimes(2);
  expect(occurrence).toHaveBeenLastCalledWith('2020-11-01T06:30:00Z', props.zone);
});

it('updates the date and occurrence when the machine time zone changes', () => {
  const timestamp = vi.spyOn(dateTime, 'formatTimestamp');
  const occurrence = vi.spyOn(dateTime, 'localTimeOccurrence');
  const props = buttonProps();
  const { rerender } = render(<QueueDateButton {...props} />);
  const button = screen.getByRole('button', { name: 'Edit date for The World' });
  const initialTitle = button.title;

  rerender(<QueueDateButton {...props} zone="UTC" />);
  expect(button.title).not.toBe(initialTitle);
  expect(button.title).not.toContain('occurrence');
  expect(timestamp).toHaveBeenCalledTimes(2);
  expect(occurrence).toHaveBeenCalledTimes(2);
  expect(timestamp).toHaveBeenLastCalledWith(props.date, 'UTC');
  expect(occurrence).toHaveBeenLastCalledWith(props.date, 'UTC');
});

it('recalculates the date title after the row unmounts', () => {
  const timestamp = vi.spyOn(dateTime, 'formatTimestamp');
  const occurrence = vi.spyOn(dateTime, 'localTimeOccurrence');
  const props = buttonProps();
  const { unmount } = render(<QueueDateButton {...props} />);
  const title = screen.getByRole('button', { name: 'Edit date for The World' }).title;
  unmount();

  render(<QueueDateButton {...props} />);
  expect(screen.getByRole('button', { name: 'Edit date for The World' })).toHaveAttribute(
    'title',
    title,
  );
  expect(timestamp).toHaveBeenCalledTimes(2);
  expect(occurrence).toHaveBeenCalledTimes(2);
});
