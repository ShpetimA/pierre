import {
  type ShikiTransformerStyleToClass,
  transformerStyleToClass,
} from '@shikijs/transformers';
import type { ElementContent, Element as HASTElement } from 'hast';
import type { ThemedToken } from 'shiki';

import type { SharedRenderState, ShikiTransformer } from '../types';
import { findCodeElement } from './hast_utils';
import { processLine } from './processLine';

interface CreateTransformerWithStateReturn {
  state: SharedRenderState;
  transformers: ShikiTransformer[];
  toClass: ShikiTransformerStyleToClass;
}

const ORIGINAL_TOKEN_COL_START = '__pierreOriginalTokenColStart';

type TokenWithOriginalRange = ThemedToken & {
  [ORIGINAL_TOKEN_COL_START]?: number;
};

export function createTransformerWithState(
  useCSSClasses = false
): CreateTransformerWithStateReturn {
  const state: SharedRenderState = { lineInfo: [] };
  const transformers: ShikiTransformer[] = [
    {
      tokens(lines) {
        for (const line of lines) {
          let col = 0;
          for (const token of line) {
            const tokenWithOriginalRange = token as TokenWithOriginalRange;
            tokenWithOriginalRange[ORIGINAL_TOKEN_COL_START] ??= col;
            col += token.content.length;
          }
        }
      },
      // preprocess(_code, options) {
      //   options.mergeWhitespaces = 'never';
      // },
      line(node) {
        // Remove the default class
        delete node.properties.class;
        return node;
      },
      pre(pre) {
        const code = findCodeElement(pre);
        const children: ElementContent[] = [];
        if (code != null) {
          let index = 1;
          for (const node of code.children) {
            if (node.type !== 'element') continue;
            wrapTokenFragments(node);
            children.push(processLine(node, index, state));
            index++;
          }
          code.children = children;
        }
        return pre;
      },
      span(hast, _line, col, _lineElement, token) {
        if (token?.offset != null && token.content != null) {
          const tokenWithOriginalRange = token as TokenWithOriginalRange;
          hast.properties['data-token-col-start'] =
            tokenWithOriginalRange[ORIGINAL_TOKEN_COL_START] ?? col;
          return hast;
        }
        return hast;
      },
    },
  ];
  if (useCSSClasses) {
    transformers.push(tokenStyleNormalizer, toClass);
  }
  return { state, transformers, toClass };
}

const toClass = transformerStyleToClass({ classPrefix: 'hl-' });

const NO_TOKEN = Symbol('no-token');
const MULTIPLE_TOKENS = Symbol('multiple-tokens');

type TokenFragmentState = number | typeof NO_TOKEN | typeof MULTIPLE_TOKENS;

// Walk a rendered line and add a single outer token wrapper around all
// fragments that still belong to the same original Shiki token.
function wrapTokenFragments(container: HASTElement): TokenFragmentState {
  const ownTokenColStart = getTokenColStart(container);
  if (ownTokenColStart != null) {
    return ownTokenColStart;
  }

  let containerTokenState: TokenFragmentState = NO_TOKEN;
  const wrappedChildren: ElementContent[] = [];
  let currentTokenChildren: ElementContent[] = [];
  let currentTokenColStart: number | undefined;

  const flushTokenChildren = () => {
    if (currentTokenChildren.length === 0 || currentTokenColStart == null) {
      currentTokenChildren = [];
      currentTokenColStart = undefined;
      return;
    }

    if (currentTokenChildren.length === 1) {
      const child = currentTokenChildren[0];
      if (child?.type === 'element') {
        setTokenColStart(child, currentTokenColStart);
        for (const grandChild of child.children) {
          stripTokenColStart(grandChild);
        }
      } else {
        stripTokenColStart(child);
      }
      wrappedChildren.push(child);
      currentTokenChildren = [];
      currentTokenColStart = undefined;
      return;
    }

    for (const child of currentTokenChildren) {
      stripTokenColStart(child);
    }

    wrappedChildren.push({
      type: 'element',
      tagName: 'span',
      properties: {
        'data-token-col-start': currentTokenColStart,
      },
      children: currentTokenChildren,
    });

    currentTokenChildren = [];
    currentTokenColStart = undefined;
  };

  const mergeContainerTokenState = (childTokenState: TokenFragmentState) => {
    if (childTokenState === NO_TOKEN) {
      return;
    }
    if (childTokenState === MULTIPLE_TOKENS) {
      containerTokenState = MULTIPLE_TOKENS;
      return;
    }
    if (containerTokenState === NO_TOKEN) {
      containerTokenState = childTokenState;
      return;
    }
    if (containerTokenState !== childTokenState) {
      containerTokenState = MULTIPLE_TOKENS;
    }
  };

  for (const child of container.children) {
    const childTokenState =
      child.type === 'element' ? wrapTokenFragments(child) : NO_TOKEN;
    mergeContainerTokenState(childTokenState);

    if (typeof childTokenState !== 'number') {
      flushTokenChildren();
      wrappedChildren.push(child);
      continue;
    }

    if (
      currentTokenColStart != null &&
      currentTokenColStart !== childTokenState
    ) {
      flushTokenChildren();
    }

    currentTokenColStart ??= childTokenState;
    currentTokenChildren.push(child);
  }

  flushTokenChildren();
  container.children = wrappedChildren;
  return containerTokenState;
}

function getTokenColStart(node: HASTElement): number | undefined {
  const value = node.properties['data-token-col-start'];
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function stripTokenColStart(node: ElementContent): void {
  if (node.type !== 'element') return;
  delete node.properties['data-token-col-start'];
  for (const child of node.children) {
    stripTokenColStart(child);
  }
}

function setTokenColStart(node: HASTElement, tokenColStart: number): void {
  node.properties['data-token-col-start'] = tokenColStart;
}

// Create a transformer that converts token color/fontStyle to htmlStyle
// This needs to run BEFORE transformerStyleToClass
const tokenStyleNormalizer: ShikiTransformer = {
  name: 'token-style-normalizer',
  tokens(lines) {
    for (const line of lines) {
      for (const token of line) {
        // Skip if htmlStyle is already set
        if (token.htmlStyle != null) continue;

        const style: Record<string, string> = {};

        if (token.color != null) {
          style.color = token.color;
        }
        if (token.bgColor != null) {
          style['background-color'] = token.bgColor;
        }
        if (token.fontStyle != null && token.fontStyle !== 0) {
          // FontStyle is a bitmask: 1 = italic, 2 = bold, 4 = underline
          if ((token.fontStyle & 1) !== 0) {
            style['font-style'] = 'italic';
          }
          if ((token.fontStyle & 2) !== 0) {
            style['font-weight'] = 'bold';
          }
          if ((token.fontStyle & 4) !== 0) {
            style['text-decoration'] = 'underline';
          }
        }

        // Only set htmlStyle if we have any styles
        if (Object.keys(style).length > 0) {
          token.htmlStyle = style;
        }
      }
    }
  },
};
