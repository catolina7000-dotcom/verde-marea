import Image from "next/image";

// Вход и регистрация: форма слева, фото зала справа (только на широком экране).
export function AuthSplit({ children }: { children: React.ReactNode }) {
  return (
    <div className="auth-split">
      <div className="auth-split-form">{children}</div>
      <div className="auth-split-media" aria-hidden="true">
        <Image src="/images/kitchen.jpg" alt="" fill sizes="(min-width: 768px) 560px, 0px" className="auth-split-img" />
        <p className="auth-split-caption font-display">Открытая кухня, вечерний зал и стол, который ждёт вас.</p>
      </div>
    </div>
  );
}
