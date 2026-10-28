import type {
  ComparePageModel,
  ComparePageResult,
  CompareCategorySummary,
  CompareTextChange,
} from '../types.ts';
import { t } from '../../i18n/i18n.js';
import { diffTextRuns } from './diff-text-runs.ts';
import { diffTextRunsAsync } from '../worker-api.ts';
import {
  classifyChangeCategory,
  diffAnnotations,
  diffImages,
  buildCategorySummary,
} from './compare-content.ts';

const EMPTY_CATEGORY_SUMMARY: CompareCategorySummary = {
  text: 0,
  image: 0,
  'header-footer': 0,
  annotation: 0,
  formatting: 0,
  background: 0,
};

// diffTextRuns may run in a worker that has no translations, so the
// descriptions of its changes are rebuilt here from the change fields.
function localizeTextChange(change: CompareTextChange): void {
  if (change.type === 'modified') {
    change.description = t('tools:comparePdfs.msg.replacedText', {
      before: change.beforeText,
      after: change.afterText,
    });
  } else if (change.type === 'removed') {
    change.description = t('tools:comparePdfs.msg.removedText', {
      text: change.beforeText,
    });
  } else if (change.type === 'added') {
    change.description = t('tools:comparePdfs.msg.addedText', {
      text: change.afterText,
    });
  } else if (change.type === 'moved') {
    change.description = t('tools:comparePdfs.msg.movedText', {
      text: change.beforeText.slice(0, 80),
    });
  } else if (change.type === 'style-changed') {
    const [head, ...details] = change.description.split('\n');
    const count = Number(head.match(/\((\d+) regions\)/)?.[1] ?? 0);
    const lines = [t('tools:comparePdfs.msg.styleChanged', { count })];
    for (const detail of details) {
      const size = detail.match(/^• Font size: (.*) → (.*)$/);
      const font = detail.match(/^• Font: (.*) → (.*)$/);
      if (size)
        lines.push(
          `• ${t('tools:comparePdfs.msg.fontSizeChange', { before: size[1], after: size[2] })}`
        );
      else if (font)
        lines.push(
          `• ${t('tools:comparePdfs.msg.fontChange', { before: font[1], after: font[2] })}`
        );
      else lines.push(detail);
    }
    change.description = lines.join('\n');
  }
}

export function comparePageModels(
  leftPage: ComparePageModel | null,
  rightPage: ComparePageModel | null
): ComparePageResult {
  return comparePageModelsCore(leftPage, rightPage, false) as ComparePageResult;
}

export function comparePageModelsAsync(
  leftPage: ComparePageModel | null,
  rightPage: ComparePageModel | null
): Promise<ComparePageResult> {
  return comparePageModelsCore(
    leftPage,
    rightPage,
    true
  ) as Promise<ComparePageResult>;
}

function comparePageModelsCore(
  leftPage: ComparePageModel | null,
  rightPage: ComparePageModel | null,
  useWorker: boolean
): ComparePageResult | Promise<ComparePageResult> {
  if (leftPage && !rightPage) {
    return {
      status: 'left-only',
      leftPageNumber: leftPage.pageNumber,
      rightPageNumber: null,
      changes: [
        {
          id: 'page-removed',
          type: 'page-removed',
          category: 'text',
          description: t('tools:comparePdfs.msg.pageOnlyInFirst', {
            page: leftPage.pageNumber,
          }),
          beforeText: leftPage.plainText.slice(0, 200),
          afterText: '',
          beforeRects: [],
          afterRects: [],
        },
      ],
      summary: { added: 0, removed: 1, modified: 0, moved: 0, styleChanged: 0 },
      categorySummary: { ...EMPTY_CATEGORY_SUMMARY, text: 1 },
      visualDiff: null,
      usedOcr: leftPage.source === 'ocr',
    };
  }

  if (!leftPage && rightPage) {
    return {
      status: 'right-only',
      leftPageNumber: null,
      rightPageNumber: rightPage.pageNumber,
      changes: [
        {
          id: 'page-added',
          type: 'page-added',
          category: 'text',
          description: t('tools:comparePdfs.msg.pageOnlyInSecond', {
            page: rightPage.pageNumber,
          }),
          beforeText: '',
          afterText: rightPage.plainText.slice(0, 200),
          beforeRects: [],
          afterRects: [],
        },
      ],
      summary: { added: 1, removed: 0, modified: 0, moved: 0, styleChanged: 0 },
      categorySummary: { ...EMPTY_CATEGORY_SUMMARY, text: 1 },
      visualDiff: null,
      usedOcr: rightPage.source === 'ocr',
    };
  }

  if (!leftPage || !rightPage) {
    return {
      status: 'match',
      leftPageNumber: null,
      rightPageNumber: null,
      changes: [],
      summary: { added: 0, removed: 0, modified: 0, moved: 0, styleChanged: 0 },
      categorySummary: { ...EMPTY_CATEGORY_SUMMARY },
      visualDiff: null,
      usedOcr: false,
    };
  }

  function buildResult(diff: {
    changes: ComparePageResult['changes'];
    summary: ComparePageResult['summary'];
  }): ComparePageResult {
    const allChanges = [...diff.changes];
    const pageHeight = Math.max(leftPage!.height, rightPage!.height);

    for (const c of allChanges) {
      localizeTextChange(c);
      if (c.category === 'text') {
        c.category = classifyChangeCategory(c, pageHeight);
      }
    }

    const annotChanges = diffAnnotations(
      leftPage!.annotations ?? [],
      rightPage!.annotations ?? [],
      allChanges.length
    );
    allChanges.push(...annotChanges);

    const imageChanges = diffImages(
      leftPage!.images ?? [],
      rightPage!.images ?? [],
      allChanges.length
    );
    allChanges.push(...imageChanges);

    return {
      status: allChanges.length > 0 ? 'changed' : 'match',
      leftPageNumber: leftPage!.pageNumber,
      rightPageNumber: rightPage!.pageNumber,
      changes: allChanges,
      summary: diff.summary,
      categorySummary: buildCategorySummary(allChanges),
      visualDiff: null,
      usedOcr: leftPage!.source === 'ocr' || rightPage!.source === 'ocr',
    };
  }

  if (useWorker) {
    return diffTextRunsAsync(leftPage.textItems, rightPage.textItems).then(
      buildResult
    );
  }

  return buildResult(diffTextRuns(leftPage.textItems, rightPage.textItems));
}
