import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../spotter/spot_repository.dart';
import 'party_repository.dart';

// main 에서 실제 저장소로 덮어쓴다. 기본은 파티 없음(이 폰 전용).
final partyRepositoryProvider = Provider<PartyRepository>((_) => LocalPartyRepository());

final spotRepositoryProvider = Provider<SpotRepository>((ref) {
  final party = ref.watch(partyRepositoryProvider);
  return party.available ? FirestoreSpotRepository(FirebaseFirestore.instance, party) : LocalSpotRepository();
});

class PartyView {
  const PartyView({required this.party, required this.members, required this.me});

  final Party? party;
  final List<Member> members;
  final String me;

  String nameOf(String uid) =>
      members.where((m) => m.uid == uid).firstOrNull?.displayName ?? '파티원';

  List<Member> get others => members.where((m) => m.uid != me).toList();
}

final partyViewProvider = FutureProvider<PartyView>((ref) async {
  final repo = ref.watch(partyRepositoryProvider);
  return PartyView(party: await repo.party(), members: await repo.members(), me: repo.me);
});

/// 나에게 온 스포터 결과(확인 대기). 파티가 바뀌면 다시 구독한다.
final incomingSpotsProvider = StreamProvider<List<PendingSpot>>((ref) {
  ref.watch(partyViewProvider);
  return ref.watch(spotRepositoryProvider).incoming();
});
