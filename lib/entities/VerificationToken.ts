import { Entity, Column, PrimaryColumn, Index } from "typeorm";

@Entity("verification_tokens")
@Index(["identifier", "token"], { unique: true })
export class VerificationToken {
  @PrimaryColumn({ type: "varchar" })
  identifier!: string;

  @Column({ type: "varchar" })
  token!: string;

  @Column({ type: "timestamp" })
  expires!: Date;
}
