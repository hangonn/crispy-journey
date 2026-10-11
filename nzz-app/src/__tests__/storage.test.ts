import * as FileSystem from 'expo-file-system/legacy';
import { getSavedArticleUrl } from '../saved/storage';

jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///data/user/0/com.anonymous.nzzapp/files/',
  cacheDirectory: 'file:///data/user/0/com.anonymous.nzzapp/cache/',
  getInfoAsync: jest.fn(),
  readDirectoryAsync: jest.fn(),
  readAsStringAsync: jest.fn(),
  deleteAsync: jest.fn(),
  makeDirectoryAsync: jest.fn(),
  moveAsync: jest.fn(),
  downloadAsync: jest.fn(),
  writeAsStringAsync: jest.fn(),
}));

describe('getSavedArticleUrl', () => {
  afterEach(() => jest.clearAllMocks());

  it('does not double the file:// scheme when documentDirectory already has it', async () => {
    (FileSystem.getInfoAsync as jest.Mock).mockResolvedValue({ exists: true });

    const url = await getSavedArticleUrl('1', 'abc12345');

    expect(url).toBe('file:///data/user/0/com.anonymous.nzzapp/files/saved-articles/1-abc12345/index.html');
    expect(url).not.toContain('file://file://');
  });

  it('returns null when the copy is not on disk', async () => {
    (FileSystem.getInfoAsync as jest.Mock).mockResolvedValue({ exists: false });

    expect(await getSavedArticleUrl('1', 'abc12345')).toBeNull();
  });
});
