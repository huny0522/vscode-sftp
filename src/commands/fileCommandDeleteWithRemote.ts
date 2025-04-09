import { COMMAND_DELETE_WITH_REMOTE } from '../constants';
import { upath } from '../core';
import { removeRemote } from '../fileHandlers';
import { showConfirmMessage } from '../host';
import { checkFileCommand } from './abstract/createCommand';
import { uriFromExplorerContextOrEditorContext } from './shared';
import * as vscode from 'vscode';
import * as fs from 'fs-extra';
import logger from '../logger';

export default checkFileCommand({
  id: COMMAND_DELETE_WITH_REMOTE,
  async getFileTarget(item, items) {
    const targets = await uriFromExplorerContextOrEditorContext(item, items);

    if (!targets) {
      return;
    }

    const filename = Array.isArray(targets)
      ? targets.map(t => upath.basename(t.fsPath)).join(',')
      : upath.basename(targets.fsPath);
    const result = await showConfirmMessage(
      `정말로 로컬 및 원격 파일 '${filename}'을 삭제하시겠습니까?`,
      '삭제',
      '취소'
    );

    return result ? targets : undefined;
  },

  async handleFile(ctx) {
    try {
      // 1. 원격 파일 삭제
      await removeRemote(ctx);

      // 2. 로컬 파일 삭제
      const localPath = ctx.target.localFsPath;

      try {
        const stat = await fs.stat(localPath);

        if (stat.isDirectory()) {
          await fs.remove(localPath);
          logger.info(`로컬 디렉토리 삭제됨: ${localPath}`);
        } else {
          await fs.unlink(localPath);
          logger.info(`로컬 파일 삭제됨: ${localPath}`);
        }
      } catch (error) {
        logger.error(`로컬 파일 삭제 실패: ${localPath}`, error);
        throw error;
      }
    } catch (error) {
      vscode.window.showErrorMessage(`파일 삭제 중 오류 발생: ${error.message}`);
    }
  },
});