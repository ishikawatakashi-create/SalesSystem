export default function MyDeskPage() {
  return (
    <div>
      <h1 className="mb-4 text-base font-bold">マイデスク</h1>
      <div className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-500">
        <p>ログインに成功しました(認証スパイク確認用画面)。</p>
        <p className="mt-2">
          自分の担当顧客・今後のアクション・期限超過の表示は、Phase
          2以降で実装されます。
        </p>
      </div>
    </div>
  );
}
