import os
import smtplib
from email.message import EmailMessage


def send_invite(to: str, link: str, inviter: str) -> None:
    msg = EmailMessage()
    msg["Subject"] = "You are invited to AMConnect"
    msg["From"] = os.environ.get("MAIL_FROM", "no-reply@amconnect.local")
    msg["To"] = to
    msg.set_content(
        f"{inviter} invited you to AMConnect.\n\n"
        f"Accept the invitation (valid for 7 days):\n{link}\n"
    )
    with smtplib.SMTP(
        os.environ["SMTP_HOST"], int(os.environ.get("SMTP_PORT", "25"))
    ) as smtp:
        smtp.send_message(msg)
