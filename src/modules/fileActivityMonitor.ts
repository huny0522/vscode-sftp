import * as vscode from 'vscode';
import logger from '../logger';
import { realpathSync, readFileSync, unlinkSync } from 'fs';
import app from '../app';
import StatusBarItem from '../ui/statusBarItem';
import { onDidOpenTextDocument, onDidSaveTextDocument, showConfirmMessage } from '../host';
import { readConfigsFromFile } from './config';
import {
  createFileService,
  getFileService,
  findAllFileService,
  disposeFileService,
} from './serviceManager';
import { reportError, isValidFile, isConfigFile, isInWorkspace } from '../helper';
import { downloadFile, uploadFile, downloadTempFile } from '../fileHandlers';
import { createHash } from 'crypto';

let workspaceWatcher: vscode.Disposable;

async function handleConfigSave(uri: vscode.Uri) {
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
  if (!workspaceFolder) {
    return;
  }

  const workspacePath = workspaceFolder.uri.fsPath;

  // dispose old service
  findAllFileService(service => service.workspace === workspacePath).forEach(disposeFileService);

  // create new service
  try {
    const configs = await readConfigsFromFile(uri.fsPath);
    configs.forEach(config => createFileService(config, workspacePath));
  } catch (error) {
    reportError(error);
  } finally {
    app.remoteExplorer.refresh();
  }
}

async function handleFileSave(uri: vscode.Uri) {
  const fileService = getFileService(uri);
  if (!fileService) {
    return;
  }

  const config = fileService.getConfig();
  if (config.uploadOnSave) {
    const fspath = await realpathSync.native(uri.fsPath);
    uri = vscode.Uri.file(fspath);
    logger.info(`[file-save] ${fspath}`);
    try {
      await uploadFile(uri);
    } catch (error) {
      logger.error(error, `download ${fspath}`);
      app.sftpBarItem.updateStatus(StatusBarItem.Status.error);
    }
  }
}

// @ts-ignore
async function areFilesIdentical(localUri: vscode.Uri, remoteUri: vscode.Uri): Promise<boolean> {
  // 다운로드한 파일 내용을 가져옵니다.
  await downloadTempFile(remoteUri);

  // Read local file content
  // @ts-ignore
  if(typeof remoteUri.temp === 'undefined') return true;
  // @ts-ignore
  const tempFile = remoteUri.temp;
  const localContent = readFileSync(tempFile, 'utf-8');
  const remoteContent = readFileSync(remoteUri.fsPath, 'utf-8');
  console.log('TEST2 - localContent:', localContent);
  console.log('TEST2 - remoteContent:', remoteUri, remoteContent);

  // Calculate hashes
  const localHash = createHash('sha256').update(localContent).digest('hex');
  const remoteHash = createHash('sha256').update(remoteContent).digest('hex');

  // Clean up the temporary file
  unlinkSync(tempFile);

  // 두 파일이 같은지 로그에 출력
  logger.info(`[file-open] ${tempFile} is identical to remote: ${localHash === remoteHash}`);
  return localHash === remoteHash;
}

async function downloadOnOpen(uri: vscode.Uri) {
  const fileService = getFileService(uri);
  if (!fileService) {
    return;
  }

  const config = fileService.getConfig();
  if (config.downloadOnOpen) {
    const remoteUri = uri; // Assuming uri is the remote file URI


    if (config.downloadOnOpen === 'confirm') {
      if (await areFilesIdentical(uri, remoteUri)) {
        logger.info(`[file-open] ${uri.fsPath} is identical to remote, skipping download.`);
        return;
      }
      const isConfirm = await showConfirmMessage(`file: '${uri.fsPath}'\nDo you want SFTP to download this file?`);
      if (!isConfirm) return;
    }

    const fspath = uri.fsPath;
    logger.info(`[file-open] ${fspath}`);
    try {
      await downloadFile(uri);
    } catch (error) {
      logger.error(error, `download ${fspath}`);
      app.sftpBarItem.updateStatus(StatusBarItem.Status.error);
    }
  }
}

function watchWorkspace({
  onDidSaveFile,
  onDidSaveSftpConfig,
}: {
  onDidSaveFile: (uri: vscode.Uri) => void;
  onDidSaveSftpConfig: (uri: vscode.Uri) => void;
}) {
  if (workspaceWatcher) {
    workspaceWatcher.dispose();
  }

  workspaceWatcher = onDidSaveTextDocument((doc: vscode.TextDocument) => {
    const uri = doc.uri;
    if (!isValidFile(uri) || !isInWorkspace(uri.fsPath)) {
      return;
    }

    // remove staled cache
    if (app.fsCache.has(uri.fsPath)) {
      app.fsCache.del(uri.fsPath);
    }

    if (isConfigFile(uri)) {
      onDidSaveSftpConfig(uri);
      return;
    }

    onDidSaveFile(uri);
  });
}

function waitActiveEditor(success: () => void, cnt: number = 0) {
  if(cnt > 500){
    logger.info(`[waitActiveEditor] timeout`);
    return;
  }

  const activeEditor = vscode.window.activeTextEditor;
  if (activeEditor) {
    success();
    return;
  }
  setTimeout(() => waitActiveEditor(success, cnt + 1), 100);
}

export function checkFileOnOpen(){
  // 프로젝트 실행 시 이미 열려 있는 파일 확인
  logger.info(`[init] checkFileOnOpen`);
  vscode.window.visibleTextEditors.forEach(editor => {
    const doc = editor.document;
    logger.info(`[init] checkFileOnOpen: ${doc.uri.fsPath}`);
    if (!isValidFile(doc.uri) || !isInWorkspace(doc.uri.fsPath)) {
      return;
    }

    // 모든 에디터에서 실제로 열린 파일 확인, 임시 파일 및 출력 창 제외
    if (editor.document.uri.scheme === 'file' &&
        editor.document.uri.fsPath.indexOf('extension-output-') === -1 &&
        editor.viewColumn !== undefined) {
      downloadOnOpen(doc.uri);
    }
  });
}

function init() {
  onDidOpenTextDocument((doc: vscode.TextDocument) => {
    if (!isValidFile(doc.uri) || !isInWorkspace(doc.uri.fsPath)) {
      return;
    }

    waitActiveEditor(() => {
      const activeEditor = vscode.window.activeTextEditor;
      if (activeEditor) {
        const isDocumentOpen = activeEditor.document.uri.scheme === 'file' &&
            activeEditor.document.uri.fsPath === doc.uri.fsPath;

        if (!isDocumentOpen) return;
        downloadOnOpen(doc.uri);
      }
    });
  });

  watchWorkspace({
    onDidSaveFile: handleFileSave,
    onDidSaveSftpConfig: handleConfigSave,
  });
}

function destory() {
  if (workspaceWatcher) {
    workspaceWatcher.dispose();
  }
}

export default {
  init,
  destory,
};
