import { refreshRemoteExplorer } from './shared';
import { fileOperations, FileType } from '../core';
import createFileHandler from './createFileHandler';
import { FileHandleOption } from './option';
import logger from '../logger';

export const removeRemote = createFileHandler<FileHandleOption & { skipDir?: boolean }>({
  name: 'removeRemote',
  async handle(option) {
    const remoteFs = await this.fileService.getRemoteFileSystem(this.config);
    const { remoteFsPath } = this.target;

    try {
      const stat = await remoteFs.lstat(remoteFsPath);

      switch (stat.type) {
        case FileType.Directory:
          if (option.skipDir) {
            return;
          }
          await fileOperations.removeDir(remoteFsPath, remoteFs, {});
          logger.info(`Directory removed: ${remoteFsPath}`);
          break;

        case FileType.File:
        case FileType.SymbolicLink:
          await fileOperations.removeFile(remoteFsPath, remoteFs, {});
          logger.info(`File removed: ${remoteFsPath}`);
          break;

        default:
          logger.warn(`Unsupported file type (type = ${stat.type}). File ${remoteFsPath}`);
      }
    } catch (error) {
      logger.error(`Failed to remove remote file: ${remoteFsPath}`, error);
      throw error; // 에러를 상위로 전파하여 UI에 표시
    }
  },
  transformOption() {
    const config = this.config;
    return {
      ignore: config.ignore,
      skipDir: false, // 명시적으로 skipDir 기본값 설정
    };
  },
  afterHandle() {
    refreshRemoteExplorer(this.target, false);
  },
});
