import { useState } from "react";
import { describeError } from "../../../shared/api/client";
import { Alert } from "../../../shared/ui/alert";
import { Badge } from "../../../shared/ui/badge";
import { Card, CardDescription, CardHeader, CardTitle } from "../../../shared/ui/card";
import { Tabs } from "../../../shared/ui/tabs";
import { receiverUrlFor } from "../../receiver/api/receiver";
import { qrSvgUrl } from "../api/network";
import { useNetworkQuery } from "../hooks/useNetwork";
import { isRfc1918Cidr, type QrEcc } from "../schemas/network";

const ECC_TABS = [
  { value: "M", label: "ECC M (15%)" },
  { value: "Q", label: "ECC Q (25%)" }
] as const satisfies readonly { value: QrEcc; label: string }[];

function UrlRow({ label, url }: { readonly label: string; readonly url: string }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd>
        <a href={url} target="_blank" rel="noreferrer" className="break-all font-mono text-sm text-primary underline">
          {url}
        </a>
      </dd>
    </div>
  );
}

export function NetworkPage() {
  const network = useNetworkQuery();
  const [ecc, setEcc] = useState<QrEcc>("M");

  if (network.isPending) return <p role="status">Carregando rede…</p>;
  if (network.isError) return <Alert tone="error">{describeError(network.error)}</Alert>;

  const { lan, panelUrl } = network.data;
  const privateLan = isRfc1918Cidr(lan.cidr);

  return (
    <div className="grid gap-4 md:grid-cols-[1fr_auto]">
      <Card aria-labelledby="lan-title">
        <CardHeader>
          <div>
            <CardTitle id="lan-title">Rede local</CardTitle>
            <CardDescription>
              Interface {lan.name} · {lan.address}
            </CardDescription>
          </div>
          <Badge tone={privateLan ? "success" : "danger"}>
            {privateLan ? `RFC 1918 · ${lan.cidr}` : `Fora da RFC 1918 · ${lan.cidr}`}
          </Badge>
        </CardHeader>
        <dl className="space-y-3">
          <UrlRow label="Painel na LAN" url={panelUrl} />
          <UrlRow label="Web Receiver (abra na Smart TV)" url={receiverUrlFor(panelUrl)} />
        </dl>
      </Card>

      <Card aria-labelledby="qr-title" className="md:w-72">
        <CardHeader>
          <CardTitle id="qr-title">Parear celular</CardTitle>
        </CardHeader>
        <Tabs label="Correção de erro do QR Code" items={ECC_TABS} value={ecc} onValueChange={setEcc}>
          <img
            src={qrSvgUrl(ecc)}
            alt={`QR Code para ${panelUrl}`}
            width={240}
            height={240}
            className="mx-auto rounded-md bg-white p-2"
          />
          <p className="mt-2 text-center text-xs text-muted">Gerado offline pelo servidor. Aponte a câmera do celular.</p>
        </Tabs>
      </Card>
    </div>
  );
}
