import { describe, expect, it } from 'vitest';
import { reportDocxUrl, reportHtmlUrl, reportUrl } from '../src/api.ts';

/**
 * 三种导出形态的网址是给界面按钮直接用的，拼错了不会报错、只会静默 404，
 * 所以在这里钉住形状。Word 那条从 .doc 换成 .docx（真 Word 文件）也钉在这里。
 */
describe('报告导出的网址', () => {
  it('三种形态各有一条网址，Markdown 是直接下载', () => {
    expect(reportUrl('s_1')).toBe('/api/sessions/s_1/report.md');
    expect(reportHtmlUrl('s_1')).toBe('/api/sessions/s_1/report.html');
    expect(reportDocxUrl('s_1')).toBe('/api/sessions/s_1/report.docx');
  });

  it('print 参数只在要打印时出现', () => {
    expect(reportHtmlUrl('s_1', false)).toBe('/api/sessions/s_1/report.html');
    expect(reportHtmlUrl('s_1', true)).toBe('/api/sessions/s_1/report.html?print=1');
  });

  it('会话 id 会被转义，拼不出别的路径', () => {
    expect(reportUrl('a/../../etc')).toBe('/api/sessions/a%2F..%2F..%2Fetc/report.md');
    expect(reportHtmlUrl('a b', true)).toBe('/api/sessions/a%20b/report.html?print=1');
  });
});
