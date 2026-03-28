import type { Element as HASTElement } from 'hast';
import type { ThemedToken } from 'shiki';

import { createHastElement, createTextNodeElement } from './hast_utils';

const LEADING_HORIZONTAL_WHITESPACE = /^[^\S\r\n]+/;
const TRAILING_HORIZONTAL_WHITESPACE = /[^\S\r\n]+$/;

interface ProcessedTokenSegment {
  leadingWhitespace: string;
  text: string;
  trailingWhitespace: string;
  start: number;
  end: number;
}

// Keep edge whitespace outside the interactive span so hover styling only
// covers the visible token text.
export function processToken(
  node: HASTElement,
  token: ThemedToken
): HASTElement {
  const segment = getProcessedTokenSegment(token);
  if (segment == null) {
    return node;
  }

  const { leadingWhitespace, text, trailingWhitespace, start, end } = segment;

  if (leadingWhitespace.length === 0 && trailingWhitespace.length === 0) {
    node.properties['data-token'] = text;
    node.properties['data-char-start'] = start;
    node.properties['data-char-end'] = end;
    return node;
  }

  node.children = [];
  if (leadingWhitespace.length > 0) {
    node.children.push(createTextNodeElement(leadingWhitespace));
  }
  node.children.push(
    createHastElement({
      tagName: 'span',
      properties: {
        'data-token': text,
        'data-char-start': start,
        'data-char-end': end,
      },
      children: [createTextNodeElement(text)],
    })
  );
  if (trailingWhitespace.length > 0) {
    node.children.push(createTextNodeElement(trailingWhitespace));
  }

  return node;
}

function getProcessedTokenSegment(
  token: ThemedToken
): ProcessedTokenSegment | undefined {
  const leadingWhitespace =
    LEADING_HORIZONTAL_WHITESPACE.exec(token.content)?.[0] ?? '';
  const trailingWhitespace =
    TRAILING_HORIZONTAL_WHITESPACE.exec(token.content)?.[0] ?? '';
  const contentStart = leadingWhitespace.length;
  const contentEnd = token.content.length - trailingWhitespace.length;

  if (contentStart >= contentEnd) {
    return undefined;
  }

  return {
    leadingWhitespace,
    text: token.content.slice(contentStart, contentEnd),
    trailingWhitespace,
    start: token.offset + contentStart,
    end: token.offset + contentEnd,
  };
}
