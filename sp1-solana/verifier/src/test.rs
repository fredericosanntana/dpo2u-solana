#[test]
fn test_decode_sp1_vkey_hash() {
    use crate::utils::decode_sp1_vkey_hash;

    let sp1_vkey_hash = "0x0054c0e58911dd8b993c6d8f249aa50a2e523114ec4b7ef9dd355c5f6bfbf3ce";
    let decoded_sp1_vkey_hash = decode_sp1_vkey_hash(sp1_vkey_hash).unwrap();
    assert_eq!(
        decoded_sp1_vkey_hash,
        hex_literal::hex!("0054c0e58911dd8b993c6d8f249aa50a2e523114ec4b7ef9dd355c5f6bfbf3ce")
    );
}
