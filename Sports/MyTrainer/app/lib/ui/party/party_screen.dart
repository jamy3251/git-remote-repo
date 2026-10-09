import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/theme.dart';
import '../../machines/machines_state.dart';
import '../../party/party_repository.dart';
import '../../party/party_state.dart';
import '../widgets/panel.dart';

/// 파티: 내 초대 코드, 파티원, 코드로 들어가기, 내 이름.
///
/// 파티 피드·출석 공유 동의는 아직 없다. 지금은 스포터 결과를 주고받고
/// 기구를 같이 쓰기 위한 최소한이다.
class PartyScreen extends ConsumerStatefulWidget {
  const PartyScreen({super.key});

  @override
  ConsumerState<PartyScreen> createState() => _PartyScreenState();
}

class _PartyScreenState extends ConsumerState<PartyScreen> {
  final _code = TextEditingController();
  final _name = TextEditingController();
  bool _busy = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    // 연결돼 있으면 파티원 목록을 새로 받는다. 실패해도 캐시로 보인다.
    Future.microtask(() async {
      try {
        await ref.read(partyRepositoryProvider).prime();
      } catch (_) {}
      if (mounted) ref.invalidate(partyViewProvider);
    });
  }

  @override
  void dispose() {
    _code.dispose();
    _name.dispose();
    super.dispose();
  }

  Future<void> _makeParty() async {
    await ref.read(partyRepositoryProvider).ensureParty();
    ref.invalidate(partyViewProvider);
  }

  Future<void> _join() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(partyRepositoryProvider).join(_code.text, _name.text);
      ref.invalidate(partyViewProvider);
      ref.invalidate(machinesProvider);
      _code.clear();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('파티에 들어왔어요')));
      }
    } on JoinError catch (e) {
      setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _rename() async {
    final name = _name.text.trim();
    if (name.isEmpty) return;
    await ref.read(partyRepositoryProvider).setMyName(name);
    ref.invalidate(partyViewProvider);
    if (mounted) {
      FocusScope.of(context).unfocus();
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('이름을 $name(으)로 바꿨어요')));
    }
  }

  @override
  Widget build(BuildContext context) {
    final repo = ref.watch(partyRepositoryProvider);
    final view = ref.watch(partyViewProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('파티')),
      body: !repo.available
          ? const Padding(
              padding: EdgeInsets.all(Gap.xl),
              child: Text('파티는 서버에 연결된 상태에서만 쓸 수 있어요. 지금은 이 폰에만 저장하고 있어요.',
                  style: AppText.body),
            )
          : view.when(
              loading: () => const Center(child: CircularProgressIndicator()),
              error: (e, _) => Center(child: Text('파티를 불러오지 못했어요\n$e', style: AppText.body)),
              data: (v) => ListView(
                padding: const EdgeInsets.fromLTRB(Gap.xl, Gap.md, Gap.xl, Gap.huge),
                children: [
                  if (v.party == null)
                    Panel(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          const Text('아직 파티가 없어요', style: AppText.section),
                          const SizedBox(height: Gap.xs),
                          const Text('파티를 만들고 코드를 친구에게 보내거나, 친구 코드로 들어가세요.',
                              style: AppText.caption),
                          const SizedBox(height: Gap.md),
                          FilledButton(onPressed: _makeParty, child: const Text('파티 만들기')),
                        ],
                      ),
                    )
                  else
                    _InviteCard(party: v.party!, members: v.members, me: v.me),
                  const SizedBox(height: Gap.md),
                  Panel(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        const PanelLabel('내 이름'),
                        Row(children: [
                          Expanded(
                            child: TextField(
                              controller: _name,
                              maxLength: 30,
                              decoration: InputDecoration(
                                hintText: v.members.where((m) => m.uid == v.me).firstOrNull?.displayName ??
                                    '친구들이 알아볼 이름',
                              ),
                            ),
                          ),
                          if (v.party != null)
                            TextButton(onPressed: _rename, child: const Text('바꾸기')),
                        ]),
                      ],
                    ),
                  ),
                  const SizedBox(height: Gap.md),
                  Panel(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        const PanelLabel('친구 파티에 들어가기'),
                        TextField(
                          controller: _code,
                          textCapitalization: TextCapitalization.characters,
                          maxLength: 8,
                          decoration: const InputDecoration(hintText: '초대 코드 8자리'),
                          onChanged: (_) => setState(() {}),
                        ),
                        if (_error != null)
                          Text(_error!, style: AppText.caption.copyWith(color: AppColors.coral)),
                        const SizedBox(height: Gap.xs),
                        const Text('들어가면 이 파티의 기구와 파티원이 보여요. 지금 파티에 등록한 기구는 옮겨지지 않아요.',
                            style: AppText.caption),
                        const SizedBox(height: Gap.md),
                        OutlinedButton(
                          onPressed: _busy || _code.text.trim().length != 8 || _name.text.trim().isEmpty
                              ? null
                              : _join,
                          child: Text(_name.text.trim().isEmpty ? '위에 내 이름을 먼저 적어 주세요' : '들어가기'),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
    );
  }
}

class _InviteCard extends StatelessWidget {
  const _InviteCard({required this.party, required this.members, required this.me});

  final Party party;
  final List<Member> members;
  final String me;

  @override
  Widget build(BuildContext context) => Panel(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            PanelLabel(party.name),
            Row(children: [
              Expanded(child: Text(party.inviteCode, style: AppText.display.copyWith(letterSpacing: 4))),
              IconButton(
                tooltip: '코드 복사',
                icon: const Icon(Icons.copy),
                onPressed: () {
                  Clipboard.setData(ClipboardData(text: party.inviteCode));
                  ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('초대 코드를 복사했어요')));
                },
              ),
            ]),
            const Text('같은 헬스장 친구에게 이 코드를 보내 주세요.', style: AppText.caption),
            const SizedBox(height: Gap.lg),
            Text('파티원 ${members.length}명', style: AppText.labelStrong.copyWith(color: AppColors.inkSub)),
            const SizedBox(height: Gap.xs),
            for (final m in members)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 2),
                child: Text(
                  [m.displayName, if (m.uid == me) '(나)', if (m.uid == party.ownerId) '· 파티장'].join(' '),
                  style: AppText.body,
                ),
              ),
          ],
        ),
      );
}
