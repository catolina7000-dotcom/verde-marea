import Link from "next/link";

export default function NotFound() {
  return (
    <div className="card flex max-w-xl flex-col items-start gap-3">
      <p className="eyebrow">Ошибка 404</p>
      <h2>Страница не найдена</h2>
      <p className="text-muted">Возможно, ссылка устарела. Вернитесь на главную и начните заново.</p>
      <Link href="/" className="btn btn-secondary">
        На главную
      </Link>
    </div>
  );
}
