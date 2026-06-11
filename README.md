# 府中六小ミニバス 記録アプリ(Vercelデプロイ用)

ミニバスの試合結果・選手スタッツを記録/分析するWebアプリです。
データは各端末のブラウザ内(localStorage)に保存されます。

## 公開手順(初回のみ・全部ブラウザで完結)

### 1. GitHubにアップロード
1. https://github.com で無料アカウントを作成
2. 右上の「+」→「New repository」
3. Repository name に `minibasket`(任意)と入力 → 「Create repository」
4. 「uploading an existing file」のリンクをクリック
5. このフォルダの中身(package.json、index.html、src フォルダなど)を**全部まとめて**ドラッグ&ドロップ
   - ZIPのままではなく、解凍した中身をアップしてください
   - srcフォルダごとドラッグすればフォルダ構造も保持されます
6. 「Commit changes」をクリック

### 2. Vercelで公開
1. https://vercel.com で「Sign up」→「Continue with GitHub」
2. 「Add New...」→「Project」
3. さきほどの `minibasket` リポジトリの「Import」をクリック
4. 設定は変更不要(ViteとTailwindは自動認識されます)→「Deploy」
5. 1〜2分で完了。表示されたURL(例: minibasket.vercel.app)があなたのアプリです

### 3. データの引っ越し(Claude版から移行する場合)
1. Claude上のアプリ: 設定タブ →「書き出し(JSON)」でバックアップを保存
2. Vercel版のアプリ: 設定タブ →「読み込み」でそのJSONを選択

## 更新手順(2回目以降)
1. GitHubのリポジトリページで更新したいファイル(例: src/App.jsx)を開く
2. 鉛筆アイコン(Edit)→ 新しい内容を貼り付け →「Commit changes」
   - またはトップページの「Add file」→「Upload files」で上書きアップロード
3. 1〜2分でVercelが自動で再デプロイ。**URLもデータもそのまま**です

## 注意
- データは端末ごとに保存されます(スマホとPCでデータは共有されません)
- 端末をまたいで使う場合は、JSONの書き出し/読み込みで同期してください
- 定期的に「書き出し(JSON)」でバックアップを取ることをおすすめします
